import { redisClient } from '../config/redis.js';

export const rateLimiter = (maxRequests = 100, windowSeconds = 60) => {
  return async (req, res, next) => {
    try {
      const key = `rate_limit:${req.ip}`;
      const current = await redisClient.incr(key);

      if (current === 1) {
        await redisClient.expire(key, windowSeconds);
      }

      if (current > maxRequests) {
        return res.status(429).json({ error: 'Too many requests, please try again later' });
      }

      next();
    } catch (error) {
      next();
    }
  };
};
