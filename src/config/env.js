import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: process.env.PORT || 3000,
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/ticketflow',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET || 'default-jwt-secret',
  barcodeSecret: process.env.BARCODE_SECRET || 'default-barcode-secret-key',
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || 'default-webhook-secret',
  nodeEnv: process.env.NODE_ENV || 'development',
};

export const JOB_CONCURRENCY = {
  PAYMENT: 5,
  HOLD_EXPIRY: 1,
  WAITLIST_NOTIFIER: 3,
};
