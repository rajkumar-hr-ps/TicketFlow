import crypto from 'crypto';
import { Payment, PaymentStatus } from '../models/Payment.js';
import { Order, OrderStatus, OrderPaymentStatus } from '../models/Order.js';
import { Ticket, TicketStatus } from '../models/Ticket.js';
import { WebhookLog } from '../models/WebhookLog.js';
import { config } from '../config/env.js';
import { NotFoundError, UnauthorizedError, BadRequestError } from '../utils/AppError.js';

export const getPaymentsByOrder = async (orderId) => {
  const payments = await Payment.findActive({ order_id: orderId }).sort({ created_at: -1 });
  return payments;
};

//TODO: NOT IN USE
export const createPayment = async (data) => {
  const payment = new Payment(data);
  await payment.save();
  return payment;
};

//TODO: NOT IN USE
export const getPaymentById = async (paymentId) => {
  const payment = await Payment.findOneActive({ _id: paymentId });
  if (!payment) {
    throw new NotFoundError('Payment not found');
  }
  return payment;
};

const VALID_STATUS_TRANSITIONS = {
  [PaymentStatus.PENDING]: [PaymentStatus.PROCESSING, PaymentStatus.COMPLETED, PaymentStatus.FAILED],
  [PaymentStatus.PROCESSING]: [PaymentStatus.COMPLETED, PaymentStatus.FAILED],
  [PaymentStatus.COMPLETED]: [],
  [PaymentStatus.FAILED]: [PaymentStatus.PROCESSING],
};

const verifyWebhookSignature = (signature, body) => {
  if (!signature) {
    throw new UnauthorizedError('missing webhook signature');
  }

  const expectedSignature = crypto
    .createHmac('sha256', config.paymentWebhookSecret)
    .update(JSON.stringify(body))
    .digest('hex');

  try {
    if (!crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    )) {
      throw new UnauthorizedError('invalid webhook signature');
    }
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    throw new UnauthorizedError('invalid webhook signature');
  }
};

export const processWebhook = async (signature, body) => {
  verifyWebhookSignature(signature, body);

  const { payment_id, status, amount, webhook_event_id } = body;

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

  // Find payment and order
  const payment = await Payment.findById(payment_id);
  if (!payment) throw new NotFoundError('payment not found');

  const order = await Order.findById(payment.order_id);
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

    await Ticket.updateMany(
      { order_id: order._id, status: TicketStatus.HELD },
      { $set: { status: TicketStatus.CONFIRMED } }
    );
  } else if (status === PaymentStatus.FAILED) {
    order.payment_status = OrderPaymentStatus.FAILED;
    await order.save();
  }

  return { received: true, payment_status: payment.status };
};
