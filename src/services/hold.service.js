import { redisClient } from '../config/redis.js';

const HOLD_TTL_SECONDS = 300; // 5 minutes

export const createHold = async (sectionId, ticketId, ttl = HOLD_TTL_SECONDS) => {
  const holdKey = `hold:${sectionId}:${ticketId}`;
  await redisClient.set(holdKey, '1', 'EX', ttl);
  return holdKey;
};

export const removeHold = async (sectionId, ticketId) => {
  const holdKey = `hold:${sectionId}:${ticketId}`;
  await redisClient.del(holdKey);
  return holdKey;
};

export const checkHold = async (sectionId, ticketId) => {
  const holdKey = `hold:${sectionId}:${ticketId}`;
  const exists = await redisClient.exists(holdKey);
  return exists === 1;
};

export const getHoldTTL = async (sectionId, ticketId) => {
  const holdKey = `hold:${sectionId}:${ticketId}`;
  return redisClient.ttl(holdKey);
};
