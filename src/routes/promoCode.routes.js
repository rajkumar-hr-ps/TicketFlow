import { Router } from 'express';
import { createPromoCode, validatePromoCode } from '../controllers/promoCode.controller.js';
import { auth } from '../middleware/auth.js';

export const router = Router();

router.post('/', auth, createPromoCode);
router.get('/:code/validate', auth, validatePromoCode);
