import { redisClient } from '../config/redis.js';

export const HOLD_TTL_SECONDS = 300;
export const HOLD_TTL_MS = HOLD_TTL_SECONDS * 1000;

export const holdKey = (sectionId, ticketId) => `hold:${sectionId}:${ticketId}`;

export const createHold = async (sectionId, ticketId, ttl = HOLD_TTL_SECONDS) => {
  const key = holdKey(sectionId, ticketId);
  await redisClient.set(key, '1', 'EX', ttl);
  return key;
};

export const removeHold = async (sectionId, ticketId) => {
  const key = holdKey(sectionId, ticketId);
  await redisClient.del(key);
  return key;
};

