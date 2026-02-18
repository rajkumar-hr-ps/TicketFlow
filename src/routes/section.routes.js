import { Router } from 'express';
import { getSections, getSectionAvailability } from '../controllers/section.controller.js';

export const router = Router();

router.get('/:id/sections', getSections);
router.get('/:eventId/sections/:sectionId/availability', getSectionAvailability);
