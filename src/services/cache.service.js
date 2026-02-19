import { redisClient } from '../config/redis.js';

export const CACHE_TTL = {
  DEFAULT: 300,
  EVENTS_LIST: 60,
  VENUES: 300,
};

export const getCache = async (key) => {
  try {
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.warn(`[cache] getCache failed for key="${key}":`, err.message);
    return null;
  }
};

export const setCache = async (key, data, ttlSeconds = 300) => {
  try {
    await redisClient.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch (err) {
    console.warn(`[cache] setCache failed for key="${key}":`, err.message);
  }
};

export const invalidateCache = async (pattern) => {
  try {
    const keys = await redisClient.keys(pattern);
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } catch (err) {
    console.warn(`[cache] invalidateCache failed for pattern="${pattern}":`, err.message);
  }
};
