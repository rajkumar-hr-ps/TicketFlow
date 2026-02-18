import { Router } from 'express';
import { getDynamicPricing } from './controller.js';
import { auth } from '../../middleware/auth.js';

export const router = Router();

router.get('/:id/pricing', auth, getDynamicPricing);
