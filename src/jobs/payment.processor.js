import { Worker } from 'bullmq';
import { Payment, PaymentStatus } from '../models/Payment.js';
import { Order, OrderStatus, OrderPaymentStatus } from '../models/Order.js';
import { config, JOB_CONCURRENCY } from '../config/env.js';
import { confirmOrderTickets } from '../services/ticket.service.js';

const connection = {
  host: new URL(config.redisUrl).hostname || 'localhost',
  port: parseInt(new URL(config.redisUrl).port, 10) || 6379,
};

const paymentWorker = new Worker(
  'payment',
  async (job) => {
    const { payment_id } = job.data;

    const payment = await Payment.findById(payment_id);
    if (!payment) throw new Error('Payment not found');

    // Idempotency: skip if already completed
    if (payment.status === PaymentStatus.COMPLETED) {
      return { skipped: true, reason: 'already completed' };
    }

    // Process payment
    payment.status = PaymentStatus.COMPLETED;
    payment.processed_at = new Date();
    await payment.save();

    // Update order
    const order = await Order.findById(payment.order_id);
    if (order) {
      order.status = OrderStatus.CONFIRMED;
      order.payment_status = OrderPaymentStatus.PAID;
      await order.save();

      // Confirm all held tickets with counter transitions
      await confirmOrderTickets(order._id);
    }

    return { payment_id, status: PaymentStatus.COMPLETED };
  },
  {
    connection,
    concurrency: JOB_CONCURRENCY.PAYMENT,
  }
);

paymentWorker.on('failed', (job, err) => {
  console.error(`Payment job ${job?.id} failed:`, err.message);
});

export { paymentWorker };
