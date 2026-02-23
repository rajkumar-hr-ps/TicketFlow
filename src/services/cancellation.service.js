import { Event, EventStatus } from '../models/Event.js';
import { VenueSection } from '../models/VenueSection.js';
import { Order, OrderStatus, OrderPaymentStatus } from '../models/Order.js';
import { Ticket, TicketStatus } from '../models/Ticket.js';
import { Payment, PaymentStatus, PaymentType } from '../models/Payment.js';
import { PromoCode } from '../models/PromoCode.js';
import { BadRequestError, NotFoundError } from '../utils/AppError.js';
import * as cacheService from './cache.service.js';
import { removeHold } from './hold.service.js';
import { roundMoney, idempotencyKey } from '../utils/helpers.js';

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
    status: OrderStatus.CONFIRMED,
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
          idempotency_key: idempotencyKey.cancelRefund(eventId, order._id),
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
    await removeHold(held.section_id, held._id);
  }
  await Ticket.updateMany(
    { event_id: eventId, status: TicketStatus.HELD },
    { $set: { status: TicketStatus.CANCELLED } }
  );

  // 4. Reset section counters
  await VenueSection.updateMany(
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
