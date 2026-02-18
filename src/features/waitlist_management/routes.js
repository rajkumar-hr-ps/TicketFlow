import { Router } from 'express';
import { joinWaitlist, getWaitlistPosition } from './controller.js';
import { auth } from '../../middleware/auth.js';

export const router = Router();

router.post('/:id/waitlist', auth, joinWaitlist);
router.get('/:id/waitlist', auth, getWaitlistPosition);
