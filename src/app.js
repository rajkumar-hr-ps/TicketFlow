import express from 'express';
import cors from 'cors';
import { router as routes } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sanitize } from './middleware/sanitize.js';

export const app = express();

// 1. Body parsing
app.use(express.json());
app.use(cors());

// 2. Global middleware
app.use(sanitize);

// 3. Routes
app.use('/api/v1', routes);

// 4. Error handler (MUST be last)
app.use(errorHandler);
