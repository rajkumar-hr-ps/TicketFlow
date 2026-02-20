import { Router } from 'express';
import { getVenueSections, getVenueSectionAvailability } from '../controllers/venueSection.controller.js';

export const router = Router();

router.get('/:id/venue-sections', getVenueSections);
router.get('/:eventId/venue-sections/:sectionId/availability', getVenueSectionAvailability);
