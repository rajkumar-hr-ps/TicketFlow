import mongoose from 'mongoose';
import { Event, EventStatus, VALID_TRANSITIONS } from '../models/Event.js';
import { Section } from '../models/Section.js';
import { Venue } from '../models/Venue.js';
import { Order, OrderStatus, OrderPaymentStatus } from '../models/Order.js';
import { Ticket, TicketStatus } from '../models/Ticket.js';
import { Payment, PaymentStatus, PaymentType } from '../models/Payment.js';
import { PromoCode } from '../models/PromoCode.js';
import { redisClient } from '../config/redis.js';
import { BadRequestError, NotFoundError, ConflictError } from '../utils/AppError.js';
import * as cacheService from './cache.service.js';
import { roundMoney } from '../utils/helpers.js';

const BUFFER_HOURS = 4;

// --- Bug 6 Solution: Venue availability with range overlap ---
export const checkVenueAvailability = async (venueId, startDate, endDate, excludeEventId = null) => {
  const requestedStart = new Date(startDate);
  const requestedEnd = new Date(endDate);

  if (requestedEnd <= requestedStart) {
    throw new BadRequestError('end_date must be after start_date');
  }

  const bufferedStart = new Date(requestedStart.getTime() - BUFFER_HOURS * 60 * 60 * 1000);
  const bufferedEnd = new Date(requestedEnd.getTime() + BUFFER_HOURS * 60 * 60 * 1000);

  const query = {
    venue_id: venueId,
    status: { $nin: [EventStatus.CANCELLED, EventStatus.DRAFT] },
    start_date: { $lt: bufferedEnd },
    end_date: { $gt: bufferedStart },
  };

  if (excludeEventId) {
    query._id = { $ne: excludeEventId };
  }

  const conflicts = await Event.findActive(query).select('title start_date end_date');

  if (conflicts.length > 0) {
    const conflictList = conflicts.map((c) => ({
      event_id: c._id,
      title: c.title,
      start_date: c.start_date,
      end_date: c.end_date,
    }));
    return {
      available: false,
      conflicts: conflictList,
      buffer_hours: BUFFER_HOURS,
    };
  }

  return { available: true, conflicts: [], buffer_hours: BUFFER_HOURS };
};

// --- Create Event with sections ---
export const createEvent = async (userId, data) => {
  const { title, description, venue_id, start_date, end_date, category, sections } = data;

  if (!title || !venue_id || !start_date || !end_date || !category) {
    throw new BadRequestError('title, venue_id, start_date, end_date, and category are required');
  }

  const venue = await Venue.findOneActive({ _id: venue_id });
  if (!venue) {
    throw new NotFoundError('Venue not found');
  }

  // Check venue availability (Bug 6 solution)
  const availability = await checkVenueAvailability(venue_id, start_date, end_date);
  if (!availability.available) {
    throw new ConflictError('venue not available — scheduling conflict');
  }

  const event = new Event({
    title,
    description,
    venue_id,
    organizer_id: userId,
    start_date,
    end_date,
    category,
    status: EventStatus.DRAFT,
  });
  await event.save();

  // Create sections if provided
  if (sections && Array.isArray(sections) && sections.length > 0) {
    const sectionDocs = sections.map((s) => ({
      event_id: event._id,
      venue_id,
      name: s.name,
      capacity: s.capacity,
      base_price: s.base_price,
    }));
    await Section.insertMany(sectionDocs);
  }

  await cacheService.invalidateCache('events:*');

  return event;
};

// --- Get Events ---
export const getEvents = async (filters = {}) => {
  const { status, category, venue_id, page = 1, limit = 20 } = filters;

  const cacheKey = `events:list:${JSON.stringify(filters)}`;
  const cached = await cacheService.getCache(cacheKey);
  if (cached) return cached;

  const query = { deleted_at: null };
  if (status) {
    const statuses = status.split(',');
    query.status = statuses.length > 1 ? { $in: statuses } : status;
  }
  if (category) query.category = category;
  if (venue_id) query.venue_id = venue_id;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
  const skip = (pageNum - 1) * limitNum;

  const [events, total] = await Promise.all([
    Event.find(query).sort({ start_date: 1 }).skip(skip).limit(limitNum).lean(),
    Event.countDocuments(query),
  ]);

  const result = {
    events,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      hasNextPage: pageNum < Math.ceil(total / limitNum),
      hasPrevPage: pageNum > 1,
    },
  };

  await cacheService.setCache(cacheKey, result, 60);

  return result;
};

// --- Get Event By ID ---
export const getEventById = async (eventId) => {
  const event = await Event.findOneActive({ _id: eventId });
  if (!event) {
    throw new NotFoundError('Event not found');
  }

  const sections = await Section.findActive({ event_id: eventId });
  const sectionsWithAvailability = sections.map((s) => ({
    ...s.toObject(),
    available: Math.max(0, s.capacity - s.sold_count - s.held_count),
  }));

  return { event, sections: sectionsWithAvailability };
};

// --- Bug 2 Solution: Event status state machine ---
export const updateEventStatus = async (eventId, newStatus, userId) => {
  const event = await Event.findOneActive({ _id: eventId, organizer_id: userId });
  if (!event) {
    throw new NotFoundError('event not found or unauthorized');
  }

  const allowedTransitions = VALID_TRANSITIONS[event.status];
  if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
    throw new BadRequestError(
      `cannot transition from '${event.status}' to '${newStatus}'`
    );
  }

  if (newStatus === EventStatus.PUBLISHED) {
    const sectionCount = await Section.countActive({ event_id: eventId });
    if (sectionCount === 0) {
      throw new BadRequestError('cannot publish event without sections');
    }
  }

  if (newStatus === EventStatus.ON_SALE && event.status === EventStatus.SOLD_OUT) {
    const sections = await Section.findActive({ event_id: eventId });
    const hasAvailable = sections.some((s) => s.capacity - s.sold_count - s.held_count > 0);
    if (!hasAvailable) {
      throw new BadRequestError('cannot set on_sale when no seats are available');
    }
  }

  if (newStatus === EventStatus.COMPLETED) {
    if (new Date(event.end_date) > new Date()) {
      throw new BadRequestError('cannot complete event before its end date');
    }
  }

  // Handle cancellation cascade (Bug 9)
  if (newStatus === EventStatus.CANCELLED) {
    return cancelEvent(eventId, userId);
  }

  event.status = newStatus;
  await event.save();

  await cacheService.invalidateCache('events:*');

  return event;
};

// --- Bug 9 Solution: Event cancellation with bulk refund cascade ---
export const cancelEvent = async (eventId, organizerId) => {
  const event = await Event.findOneActive({ _id: eventId, organizer_id: organizerId });
  if (!event) {
    throw new NotFoundError('event not found or unauthorized');
  }

  if ([EventStatus.COMPLETED, EventStatus.CANCELLED].includes(event.status)) {
    throw new BadRequestError(`cannot cancel event with status '${event.status}'`);
  }

  // 1. Set event status
  event.status = EventStatus.CANCELLED;
  await event.save();

  // 2. Process refunds for all active orders
  const orders = await Order.find({
    event_id: eventId,
    status: { $in: [OrderStatus.CONFIRMED, OrderStatus.PARTIALLY_REFUNDED] },
    deleted_at: null,
  });

  const refundResults = [];

  for (const order of orders) {
    try {
      const tickets = await Ticket.find({
        order_id: order._id,
        status: TicketStatus.CONFIRMED,
        deleted_at: null,
      });

      // Organizer cancellation: 100% base + facility fees
      const baseRefund = tickets.reduce((sum, t) => sum + t.unit_price, 0);
      const facilityRefund = tickets.reduce((sum, t) => sum + t.facility_fee, 0);
      const totalRefund = roundMoney(baseRefund + facilityRefund);

      if (totalRefund > 0) {
        await Payment.create({
          order_id: order._id,
          user_id: order.user_id,
          amount: totalRefund,
          type: PaymentType.REFUND,
          status: PaymentStatus.COMPLETED,
          idempotency_key: `cancel_refund_${eventId}_${order._id}`,
        });
      }

      await Ticket.updateMany(
        { order_id: order._id, status: TicketStatus.CONFIRMED },
        { $set: { status: TicketStatus.CANCELLED } }
      );

      order.status = OrderStatus.REFUNDED;
      order.payment_status = OrderPaymentStatus.REFUNDED;
      await order.save();

      if (order.promo_code_id) {
        await PromoCode.findByIdAndUpdate(
          order.promo_code_id,
          { $inc: { current_uses: -1 } }
        );
      }

      refundResults.push({
        order_id: order._id,
        refund_amount: totalRefund,
        tickets_cancelled: tickets.length,
        status: 'success',
      });
    } catch (err) {
      refundResults.push({
        order_id: order._id,
        status: 'failed',

        error: err.message,
      });
    }
  }

  // 3. Cancel held tickets and clean Redis
  const heldTickets = await Ticket.find({
    event_id: eventId,
    status: TicketStatus.HELD,
    deleted_at: null,
  });
  for (const held of heldTickets) {
    const holdKey = `hold:${held.section_id}:${held._id}`;
    await redisClient.del(holdKey);
  }
  await Ticket.updateMany(
    { event_id: eventId, status: TicketStatus.HELD },
    { $set: { status: TicketStatus.CANCELLED } }
  );

  // 4. Reset section counters
  await Section.updateMany(
    { event_id: eventId },
    { $set: { sold_count: 0, held_count: 0 } }
  );

  await cacheService.invalidateCache('events:*');

  return {
    event_id: eventId,
    status: EventStatus.CANCELLED,
    orders_processed: refundResults.length,
    refunds: refundResults,
    held_tickets_cancelled: heldTickets.length,
  };
};
