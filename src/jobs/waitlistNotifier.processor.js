import { Worker } from 'bullmq';
import { WaitlistEntry, WaitlistStatus } from '../models/WaitlistEntry.js';
import { config, JOB_CONCURRENCY } from '../config/env.js';

const connection = {
  host: new URL(config.redisUrl).hostname || 'localhost',
  port: parseInt(new URL(config.redisUrl).port, 10) || 6379,
};

const waitlistNotifierWorker = new Worker(
  'waitlist',
  async (job) => {
    const { event_id, available_seats } = job.data;

    // Find the next N users on the waitlist
    const entries = await WaitlistEntry.find({
      event_id,
      status: WaitlistStatus.WAITING,
    })
      .sort({ position: 1 })
      .limit(available_seats || 1);

    const notified = [];
    for (const entry of entries) {
      entry.status = WaitlistStatus.NOTIFIED;
      await entry.save();
      notified.push({
        user_id: entry.user_id,
        position: entry.position,
      });
    }

    return { event_id, notified_count: notified.length, notified };
  },
  {
    connection,
    concurrency: JOB_CONCURRENCY.WAITLIST_NOTIFIER,
  }
);

waitlistNotifierWorker.on('failed', (job, err) => {
  console.error(`Waitlist notifier job ${job?.id} failed:`, err.message);
});

export { waitlistNotifierWorker };
