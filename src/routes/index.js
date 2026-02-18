import { Router } from 'express';
import { router as authRoutes } from './auth.routes.js';
import { router as venueRoutes } from './venue.routes.js';
import { router as eventRoutes } from './event.routes.js';
import { router as sectionRoutes } from './section.routes.js';
import { router as orderRoutes } from './order.routes.js';
import { router as promoCodeRoutes } from './promoCode.routes.js';
import { router as paymentRoutes } from './payment.routes.js';

// Feature routes
import { router as seatMapRoutes } from '../features/seat_availability_map/routes.js';
import { router as scheduleRoutes } from '../features/event_schedule/routes.js';
import { router as waitlistRoutes } from '../features/waitlist_management/routes.js';
import { router as ticketTransferRoutes } from '../features/ticket_transfer/routes.js';
import { router as dynamicPricingRoutes } from '../features/dynamic_pricing/routes.js';
import { router as refundRoutes } from '../features/refund_processing/routes.js';

export const router = Router();

// Core routes
router.use('/auth', authRoutes);
router.use('/users', authRoutes);
router.use('/venues', venueRoutes);

// Event routes — schedule BEFORE :id to avoid param capture
router.use('/events', scheduleRoutes);
router.use('/events', eventRoutes);
router.use('/events', sectionRoutes);

// Feature routes on events
router.use('/events', seatMapRoutes);
router.use('/events', waitlistRoutes);
router.use('/events', dynamicPricingRoutes);

// Order routes
router.use('/orders', orderRoutes);
router.use('/orders', refundRoutes);

// Promo code routes
router.use('/promo-codes', promoCodeRoutes);

// Payment routes
router.use('/payments', paymentRoutes);
router.use('/', paymentRoutes);

// Ticket routes
router.use('/tickets', ticketTransferRoutes);
