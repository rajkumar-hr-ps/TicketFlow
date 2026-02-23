import mongoose from 'mongoose';
import Redis from 'ioredis';
import { config } from './config/env.js';

const reset = async () => {
  console.log('Resetting database and cache...');

  // Drop MongoDB databases
  try {
    await mongoose.connect(config.mongoUri);
    console.log('  - Dropping MongoDB ticketflow database...');
    await mongoose.connection.db.dropDatabase();

    // Also drop the test database
    const testDb = mongoose.connection.client.db('ticketflow_test');
    console.log('  - Dropping MongoDB ticketflow_test database...');
    await testDb.dropDatabase();

    await mongoose.disconnect();
    console.log('  ✓ MongoDB reset complete');
  } catch (err) {
    console.error('  Warning: Could not connect to MongoDB.', err.message);
  }

  // Flush Redis
  try {
    const redis = new Redis(config.redisUrl, { lazyConnect: true });
    await redis.connect();
    await redis.flushall();
    console.log('  ✓ Redis flushed');
    await redis.quit();
  } catch (err) {
    console.error('  Warning: Could not connect to Redis.', err.message);
  }

  console.log('');
  console.log('Reset complete! Run "make run" to start fresh.');
  process.exit(0);
};

reset();
