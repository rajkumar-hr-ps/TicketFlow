import { Router } from 'express';
import { getSeatAvailabilityMap } from './controller.js';

export const router = Router();

router.get('/:id/sections/:sectionId/seat-map', getSeatAvailabilityMap);
