import { Router } from 'express';
import { createVenue, getVenues, getVenueById } from '../controllers/venue.controller.js';
import { auth } from '../middleware/auth.js';

export const router = Router();

router.get('/', getVenues);
router.post('/', auth, createVenue);
router.get('/:id', getVenueById);
