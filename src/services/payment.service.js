import { Payment, PaymentStatus } from '../models/Payment.js';
import { Order, OrderStatus, OrderPaymentStatus } from '../models/Order.js';
import { WebhookLog } from '../models/WebhookLog.js';
import { NotFoundError, BadRequestError } from '../utils/AppError.js';
import { confirmOrderTickets } from './ticket.service.js';

export const getPaymentsByOrder = async (orderId, userId) => {
  if (userId) {
    const order = await Order.findOneActive({ _id: orderId, user_id: userId });
    if (!order) throw new NotFoundError('order not found');
  }
  const payments = await Payment.findActive({ order_id: orderId }).sort({ created_at: -1 });
  return payments;
};

const VALID_STATUS_TRANSITIONS = {
  [PaymentStatus.PENDING]: [PaymentStatus.PROCESSING, PaymentStatus.COMPLETED, PaymentStatus.FAILED],
  [PaymentStatus.PROCESSING]: [PaymentStatus.COMPLETED, PaymentStatus.FAILED],
  [PaymentStatus.COMPLETED]: [],
  [PaymentStatus.FAILED]: [PaymentStatus.PROCESSING],
};

export const processWebhook = async (body) => {
  const { payment_id, status, amount, webhook_event_id } = body;

  if (!payment_id || !status || amount === undefined || amount === null || !webhook_event_id) {
    throw new BadRequestError('payment_id, status, amount, and webhook_event_id are required');
  }

  if (typeof amount !== 'number' || amount < 0) {
    throw new BadRequestError('amount must be a non-negative number');
  }

  const validStatuses = Object.values(PaymentStatus);
  if (!validStatuses.includes(status)) {
    throw new BadRequestError(`status must be one of: ${validStatuses.join(', ')}`);
  }

  // Idempotency check
  const existingWebhook = await WebhookLog.findOne({ webhook_event_id });
  if (existingWebhook) {
    return { received: true, duplicate: true };
  }

  // Log this webhook event
  await WebhookLog.create({
    webhook_event_id,
    payment_id,
    status,
    received_at: new Date(),
  });

  // Find payment and order (soft-delete safe)
  const payment = await Payment.findOneActive({ _id: payment_id });
  if (!payment) throw new NotFoundError('payment not found');

  const order = await Order.findOneActive({ _id: payment.order_id });
  if (!order) throw new NotFoundError('order not found');

  // Verify amount matches order total
  if (Math.abs(amount - order.total_amount) > 0.01) {
    await WebhookLog.findOneAndUpdate(
      { webhook_event_id },
      { $set: { error: 'amount_mismatch', expected: order.total_amount, received: amount } }
    );
    throw new BadRequestError('payment amount does not match order total');
  }

  // Validate status transition
  const allowedTransitions = VALID_STATUS_TRANSITIONS[payment.status];
  if (!allowedTransitions || !allowedTransitions.includes(status)) {
    return {
      received: true,
      ignored: true,
      reason: `cannot transition from '${payment.status}' to '${status}'`,
    };
  }

  // Update payment status
  payment.status = status;
  payment.processed_at = new Date();
  await payment.save();

  // Trigger order fulfillment on successful payment
  if (status === PaymentStatus.COMPLETED) {
    order.status = OrderStatus.CONFIRMED;
    order.payment_status = OrderPaymentStatus.PAID;
    await order.save();

    await confirmOrderTickets(order._id);
  } else if (status === PaymentStatus.FAILED) {
    order.payment_status = OrderPaymentStatus.FAILED;
    await order.save();
  }

  return { received: true, payment_status: payment.status };
};
