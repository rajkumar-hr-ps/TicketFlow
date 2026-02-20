import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import { router as routes } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sanitize } from './middleware/sanitize.js';
import { rateLimiter } from './middleware/rateLimiter.js';

export const app = express();

// 1. Body parsing
app.use(express.json());
app.use(cors());

// 2. API request logger
app.use(morgan('dev'));

// 3. Swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar-wrapper .link svg { display: none; } .swagger-ui .topbar-wrapper .link::before { content: url(https://cdn.prod.website-files.com/66b6d7fd4d3e9cef94717176/6765dc51a13e31531996cef3_logo-dark.svg); }',
  customSiteTitle: 'TicketFlow API Docs',
}));
app.get('/', (req, res) => res.redirect('/api-docs'));

// 5. Global middleware
app.use(sanitize);
app.use(rateLimiter());

// 6. Routes
app.use('/api/v1', routes);

// 7. Error handler (MUST be last)
app.use(errorHandler);
