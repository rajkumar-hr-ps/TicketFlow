import { app } from './app.js';
import { config } from './config/env.js';
import { connectDB } from './config/db.js';
import { connectRedis } from './config/redis.js';

const start = async () => {
  await connectDB();
  await connectRedis();

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
