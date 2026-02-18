import mongoose from 'mongoose';
import { Order, OrderStatus, OrderPaymentStatus } from '../models/Order.js';
import { Ticket, TicketStatus } from '../models/Ticket.js';
import { Section } from '../models/Section.js';
import { Event, EventStatus } from '../models/Event.js';
import { Payment, PaymentStatus, PaymentType } from '../models/Payment.js';
import { PromoCode } from '../models/PromoCode.js';
import { redisClient } from '../config/redis.js';
import { BadRequestError, NotFoundError } from '../utils/AppError.js';
import * as pricingService from './pricing.service.js';
import * as promoCodeService from './promoCode.service.js';
import { holdKey, HOLD_TTL_SECONDS, HOLD_TTL_MS } from './hold.service.js';
import { roundMoney, getAvailableSeats, idempotencyKey as idempotencyKeyGen } from '../utils/helpers.js';

// --- Bug 1 Solution: Full pricing pipeline via pricingService ---
export const createOrder = async (userId, data) => {
  const { event_id, section_id, quantity, promo_code, idempotency_key, sections: sectionRequests } = data;

  if (!event_id) {
    throw new BadRequestError('event_id is required');
  }

  // Multi-section order (Bug 10)
  if (sectionRequests && Array.isArray(sectionRequests) && sectionRequests.length > 0) {
    return createMultiSectionOrder(userId, event_id, sectionRequests, promo_code, idempotency_key);
  }

  // Single-section order
  if (!section_id || !quantity || quantity < 1) {
    throw new BadRequestError('section_id and quantity are required');
  }

  const event = await Event.findOneActive({ _id: event_id, status: EventStatus.ON_SALE });
  if (!event) {
    throw new NotFoundError('event not available');
  }

  // Validate promo code
  let promoCode = null;
  if (promo_code) {
    const result = await promoCodeService.validatePromoCode(promo_code, event_id, quantity);
    promoCode = result.promo;
  }

  // Calculate full pricing pipeline (Bug 1 solution)
  const pricing = await pricingService.calculateOrderTotal(section_id, quantity, promoCode);

  // Check section availability
  const section = await Section.findOneActive({ _id: section_id });
  if (!section) throw new NotFoundError('section not found');

  const available = getAvailableSeats(section);
  if (available < quantity) {
    throw new BadRequestError(`insufficient capacity in section ${section.name}`);
  }

  // Increment held_count
  await Section.findByIdAndUpdate(section_id, { $inc: { held_count: quantity } });

  // Create tickets
  const tickets = [];
  const holdExpiry = new Date(Date.now() + HOLD_TTL_MS);

  for (let i = 0; i < quantity; i++) {
    const ticket = await Ticket.create({
      event_id,
      section_id,
      user_id: userId,
      original_user_id: userId,
      status: TicketStatus.HELD,
      unit_price: pricing.unit_price,
      service_fee: pricing.service_fee_per_ticket,
      facility_fee: pricing.facility_fee_per_ticket,
      hold_expires_at: holdExpiry,
    });
    tickets.push(ticket);
    await redisClient.set(holdKey(section_id, ticket._id), '1', 'EX', HOLD_TTL_SECONDS);
  }

  // Atomically increment promo usage
  let promoId = null;
  if (promoCode) {
    await PromoCode.findOneAndUpdate(
      { _id: promoCode._id, current_uses: { $lt: promoCode.max_uses } },
      { $inc: { current_uses: 1 } }
    );
    promoId = promoCode._id;
  }

  // Create order with full pricing
  const order = await Order.create({
    user_id: userId,
    event_id,
    tickets: tickets.map((t) => t._id),
    quantity,
    subtotal: pricing.subtotal,
    service_fee_total: pricing.service_fee_total,
    facility_fee_total: pricing.facility_fee_total,
    processing_fee: pricing.processing_fee,
    discount_amount: pricing.discount_amount,
    total_amount: pricing.total_amount,
    promo_code_id: promoId,
    status: OrderStatus.PENDING,
    payment_status: OrderPaymentStatus.PENDING,
    idempotency_key: idempotency_key || idempotencyKeyGen.order(userId, event_id),
  });

  // Create payment record
  await Payment.create({
    order_id: order._id,
    user_id: userId,
    amount: pricing.total_amount,
    type: PaymentType.PURCHASE,
    status: PaymentStatus.PENDING,
    idempotency_key: idempotencyKeyGen.payment(order._id),
  });

  return {
    order,
    unit_price: pricing.unit_price,
    multiplier: pricing.multiplier,
    subtotal: pricing.subtotal,
    service_fee_total: pricing.service_fee_total,
    facility_fee_total: pricing.facility_fee_total,
    processing_fee: pricing.processing_fee,
    discount_amount: pricing.discount_amount,
    total_amount: pricing.total_amount,
  };
};

// --- Bug 10 Solution: Multi-section order with MongoDB transactions ---
const createMultiSectionOrder = async (userId, eventId, sectionRequests, promoCodeStr, idempotencyKey) => {
  const event = await Event.findOneActive({ _id: eventId, status: EventStatus.ON_SALE });
  if (!event) {
    throw new NotFoundError('event not available');
  }

  const session = await mongoose.startSession();
  const createdTickets = [];
  const redisHoldKeys = [];

  try {
    session.startTransaction();

    let totalSubtotal = 0;
    let totalServiceFee = 0;
    let totalFacilityFee = 0;

    for (const req of sectionRequests) {
      // Atomic check-and-reserve within transaction
      const section = await Section.findOneAndUpdate(
        {
          _id: req.section_id,
          deleted_at: null,
          $expr: {
            $gte: [
              { $subtract: ['$capacity', { $add: ['$sold_count', '$held_count'] }] },
              req.quantity,
            ],
          },
        },
        { $inc: { held_count: req.quantity } },
        { new: true, session }
      );

      if (!section) {
        throw new BadRequestError(
          `insufficient capacity in section '${req.section_id}'`
        );
      }

      const tier = pricingService.getDynamicMultiplier(section);
      const { unitPrice, serviceFee, facilityFee } = pricingService.calculateTicketPrice(
        section.base_price,
        tier.multiplier
      );

      for (let i = 0; i < req.quantity; i++) {
        const ticket = await Ticket.create(
          [{
            event_id: eventId,
            section_id: req.section_id,
            user_id: userId,
            original_user_id: userId,
            status: TicketStatus.HELD,
            unit_price: unitPrice,
            service_fee: serviceFee,
            facility_fee: facilityFee,
            hold_expires_at: new Date(Date.now() + HOLD_TTL_MS),
          }],
          { session }
        );

        createdTickets.push(ticket[0]);
        redisHoldKeys.push(holdKey(req.section_id, ticket[0]._id));
      }

      totalSubtotal += roundMoney(unitPrice * req.quantity);
      totalServiceFee += roundMoney(serviceFee * req.quantity);
      totalFacilityFee += roundMoney(facilityFee * req.quantity);
    }

    const processingFee = pricingService.PROCESSING_FEE;
    const totalAmount = roundMoney(totalSubtotal + totalServiceFee + totalFacilityFee + processingFee);

    const order = await Order.create(
      [{
        user_id: userId,
        event_id: eventId,
        tickets: createdTickets.map((t) => t._id),
        quantity: createdTickets.length,
        subtotal: totalSubtotal,
        service_fee_total: totalServiceFee,
        facility_fee_total: totalFacilityFee,
        processing_fee: processingFee,
        total_amount: totalAmount,
        status: OrderStatus.PENDING,
        payment_status: OrderPaymentStatus.PENDING,
        idempotency_key: idempotencyKey || idempotencyKeyGen.order(userId, eventId),
      }],
      { session }
    );

    await session.commitTransaction();

    // Set Redis holds AFTER successful commit
    for (const key of redisHoldKeys) {
      await redisClient.set(key, '1', 'EX', HOLD_TTL_SECONDS);
    }

    return {
      order: order[0],
      total_amount: totalAmount,
    };
  } catch (error) {
    await session.abortTransaction();

    for (const holdKey of redisHoldKeys) {
      await redisClient.del(holdKey).catch(() => {});
    }

    if (error instanceof BadRequestError || error instanceof NotFoundError) throw error;
    throw new BadRequestError('failed to create multi-section order');
  } finally {
    session.endSession();
  }
};

// --- Get User Orders ---
export const getUserOrders = async (userId) => {
  const orders = await Order.findActive({ user_id: userId })
    .populate('tickets')
    .sort({ created_at: -1 });
  return orders;
};

// --- Get Order By ID ---
export const getOrderById = async (orderId, userId) => {
  const order = await Order.findOneActive({ _id: orderId, user_id: userId })
    .populate('tickets');
  if (!order) {
    throw new NotFoundError('order not found');
  }
  return order;
};

// --- Bug 4 Solution: Refund with tiered penalties and fee decomposition ---
export const processRefund = async (orderId, userId) => {
  const order = await Order.findOneActive({ _id: orderId, user_id: userId });
  if (!order) {
    throw new NotFoundError('order not found');
  }

  if (![OrderStatus.CONFIRMED, OrderStatus.PARTIALLY_REFUNDED].includes(order.status)) {
    throw new BadRequestError('order is not eligible for refund');
  }

  const event = await Event.findOneActive({ _id: order.event_id });
  if (!event) throw new BadRequestError('event not found');

  // 1. Determine refund tier based on time until event
  const hoursUntilEvent = (new Date(event.start_date) - new Date()) / (1000 * 60 * 60);
  const isOrganizerCancellation = event.status === EventStatus.CANCELLED;

  const refundTier = pricingService.getRefundTier(hoursUntilEvent, isOrganizerCancellation);
  if (!refundTier) {
    throw new BadRequestError('refunds not available within 24 hours of event');
  }
  const { percentage: refundPercentage, tier } = refundTier;

  // 2. Fee decomposition
  const tickets = await Ticket.find({ order_id: orderId, status: TicketStatus.CONFIRMED, deleted_at: null });
  const baseTotal = tickets.reduce((sum, t) => sum + t.unit_price, 0);
  const penalizedBase = roundMoney(baseTotal * refundPercentage);
  const facilityRefund = isOrganizerCancellation
    ? roundMoney(tickets.reduce((sum, t) => sum + t.facility_fee, 0))
    : 0;
  const totalRefund = penalizedBase + facilityRefund;

  // 3. Update ticket statuses
  await Ticket.updateMany(
    { _id: { $in: tickets.map((t) => t._id) } },
    { $set: { status: TicketStatus.REFUNDED } }
  );

  // 4. Restore section sold_count
  const sectionCounts = {};
  for (const ticket of tickets) {
    const sid = ticket.section_id.toString();
    sectionCounts[sid] = (sectionCounts[sid] || 0) + 1;
  }
  for (const [sectionId, count] of Object.entries(sectionCounts)) {
    await Section.findByIdAndUpdate(sectionId, { $inc: { sold_count: -count } });
  }

  // 5. Decrement promo code usage
  if (order.promo_code_id) {
    await PromoCode.findByIdAndUpdate(order.promo_code_id, { $inc: { current_uses: -1 } });
  }

  // 6. Create refund payment record
  await Payment.create({
    order_id: orderId,
    user_id: userId,
    amount: totalRefund,
    type: PaymentType.REFUND,
    status: PaymentStatus.COMPLETED,
    idempotency_key: idempotencyKeyGen.refund(orderId),
  });

  order.status = OrderStatus.REFUNDED;
  order.payment_status = OrderPaymentStatus.REFUNDED;
  await order.save();

  return {
    refund_amount: totalRefund,
    refund_tier: tier,
    refund_percentage: refundPercentage * 100,
    base_refund: penalizedBase,
    facility_fee_refund: facilityRefund,
    service_fee_refund: 0,
    processing_fee_refund: 0,
    tickets_refunded: tickets.length,
    order_status: order.status,
  };
};
