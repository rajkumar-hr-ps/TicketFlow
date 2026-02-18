import Redis from 'ioredis';
import { config } from './env.js';

export const redisClient = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: true,
});

redisClient.on('error', (err) => {
  console.error('Redis connection error:', err.message);
});

export const connectRedis = async () => {
  try {
    await redisClient.connect();
    console.log(`Redis connected: ${config.redisUrl}`);
  } catch (error) {
    console.error('Redis connection error:', error.message);
    process.exit(1);
  }
};
