import { app } from './app.js';
import { config } from './config/env.js';
import { connectDB } from './config/db.js';
import { connectRedis } from './config/redis.js';

const start = async () => {
  await connectDB();
  await connectRedis();

  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
};

start();
