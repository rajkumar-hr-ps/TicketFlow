import { Router } from 'express';
import { createEvent, getEvents, getEventById, updateEventStatus } from '../controllers/event.controller.js';
import { auth } from '../middleware/auth.js';

export const router = Router();

// Static routes BEFORE parameterized routes
router.get('/', getEvents);
router.post('/', auth, createEvent);
router.get('/:id', getEventById);
router.patch('/:id/status', auth, updateEventStatus);
