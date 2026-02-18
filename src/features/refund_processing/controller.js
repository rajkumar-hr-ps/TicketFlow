import { Order, OrderStatus, OrderPaymentStatus } from '../../models/Order.js';
import { Event, EventStatus } from '../../models/Event.js';
import { Ticket, TicketStatus } from '../../models/Ticket.js';
import { Section } from '../../models/Section.js';
import { Payment, PaymentStatus, PaymentType } from '../../models/Payment.js';
import { PromoCode } from '../../models/PromoCode.js';
import { roundMoney } from '../../utils/helpers.js';
import { getRefundTier } from '../../services/pricing.service.js';

export const processRefund = async (req, res) => {
  const orderId = req.params.id;
  const userId = req.user._id;

  const order = await Order.findOneActive({ _id: orderId, user_id: userId });
  if (!order) {
    return res.status(404).json({ error: 'order not found' });
  }

  if (![OrderStatus.CONFIRMED, OrderStatus.PARTIALLY_REFUNDED].includes(order.status)) {
    return res.status(400).json({ error: 'order is not eligible for refund' });
  }

  const event = await Event.findOneActive({ _id: order.event_id });
  if (!event) {
    return res.status(400).json({ error: 'event not found' });
  }

  // 1. Determine refund tier
  const hoursUntilEvent = (new Date(event.start_date) - new Date()) / (1000 * 60 * 60);
  const isOrganizerCancellation = event.status === EventStatus.CANCELLED;

  const refundTier = getRefundTier(hoursUntilEvent, isOrganizerCancellation);
  if (!refundTier) {
    return res.status(400).json({ error: 'refunds not available within 24 hours of event' });
  }
  const { percentage: refundPercentage, tier } = refundTier;

  // 2. Fee decomposition
  const tickets = await Ticket.find({ order_id: orderId, status: TicketStatus.CONFIRMED, deleted_at: null });
  if (tickets.length === 0) {
    return res.status(400).json({ error: 'no confirmed tickets to refund' });
  }

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
    idempotency_key: `refund_${orderId}_${Date.now()}`,
  });

  order.status = OrderStatus.REFUNDED;
  order.payment_status = OrderPaymentStatus.REFUNDED;
  await order.save();

  return res.json({
    refund_amount: totalRefund,
    refund_tier: tier,
    refund_percentage: refundPercentage * 100,
    base_refund: penalizedBase,
    facility_fee_refund: facilityRefund,
    service_fee_refund: 0,
    processing_fee_refund: 0,
    tickets_refunded: tickets.length,
    order_status: order.status,
  });
};
