import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import { router as routes } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sanitize } from './middleware/sanitize.js';

export const app = express();

// 1. Body parsing
app.use(express.json());
app.use(cors());

// 2. Swagger docs (before auth/sanitize middleware)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// 3. Global middleware
app.use(sanitize);

// 4. Routes
app.use('/api/v1', routes);

// 5. Error handler (MUST be last)
app.use(errorHandler);
