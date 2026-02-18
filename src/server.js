import { app } from './app.js';
import { config } from './config/env.js';
import { connectDB } from './config/db.js';
import { redisClient } from './config/redis.js';

const start = async () => {
  await connectDB();

  try {
    await redisClient.connect();
  } catch {
    console.log('Redis connection deferred — will connect on first use');
  }

  // Start background workers
  try {
    await import('./jobs/holdExpiry.processor.js');
    await import('./jobs/payment.processor.js');
    await import('./jobs/waitlistNotifier.processor.js');
    console.log('Background workers started');
  } catch (err) {
    console.log('Background workers skipped:', err.message);
  }

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
};

start();
