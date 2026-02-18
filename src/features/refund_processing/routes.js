import { Router } from 'express';
import { processRefund } from './controller.js';
import { auth } from '../../middleware/auth.js';

export const router = Router();

router.post('/:id/refund', auth, processRefund);
