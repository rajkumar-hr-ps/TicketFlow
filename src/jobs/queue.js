import { Queue } from 'bullmq';
import { config } from '../config/env.js';

const connection = {
  host: new URL(config.redisUrl).hostname || 'localhost',
  port: parseInt(new URL(config.redisUrl).port, 10) || 6379,
};

export const paymentQueue = new Queue('payment', { connection });
export const holdExpiryQueue = new Queue('holdExpiry', { connection });
export const waitlistQueue = new Queue('waitlist', { connection });
