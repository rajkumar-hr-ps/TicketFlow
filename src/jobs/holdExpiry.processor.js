import { Worker } from 'bullmq';
import { Ticket, TicketStatus } from '../models/Ticket.js';
import { Section } from '../models/Section.js';
import { Order, OrderStatus, OrderPaymentStatus } from '../models/Order.js';
import { config, JOB_CONCURRENCY } from '../config/env.js';

const connection = {
  host: new URL(config.redisUrl).hostname || 'localhost',
  port: parseInt(new URL(config.redisUrl).port, 10) || 6379,
};

const holdExpiryWorker = new Worker(
  'holdExpiry',
  async () => {
    // Find expired holds
    const expiredTickets = await Ticket.find({
      status: TicketStatus.HELD,
      hold_expires_at: { $lte: new Date() },
      deleted_at: null,
    });

    let cleaned = 0;
    const sectionCounts = {};

    for (const ticket of expiredTickets) {
      ticket.status = TicketStatus.CANCELLED;
      await ticket.save();

      const sid = ticket.section_id.toString();
      sectionCounts[sid] = (sectionCounts[sid] || 0) + 1;
      cleaned++;
    }

    // Decrement held_count for each section
    for (const [sectionId, count] of Object.entries(sectionCounts)) {
      await Section.findByIdAndUpdate(sectionId, { $inc: { held_count: -count } });
    }

    // Cancel orders with all tickets expired
    const orderIds = [...new Set(expiredTickets.map((t) => t.order_id.toString()))];
    for (const orderId of orderIds) {
      const remainingHeld = await Ticket.countDocuments({
        order_id: orderId,
        status: TicketStatus.HELD,
      });
      if (remainingHeld === 0) {
        await Order.findByIdAndUpdate(orderId, {
          status: OrderStatus.CANCELLED,
          payment_status: OrderPaymentStatus.FAILED,
        });
      }
    }

    return { cleaned };
  },
  {
    connection,
    concurrency: JOB_CONCURRENCY.HOLD_EXPIRY,
  }
);

holdExpiryWorker.on('failed', (job, err) => {
  console.error(`Hold expiry job ${job?.id} failed:`, err.message);
});

export { holdExpiryWorker };
