import { Router } from 'express';
import { getEventSchedule } from './controller.js';

export const router = Router();

// Schedule route BEFORE :id routes to avoid param capture
router.get('/schedule', getEventSchedule);
