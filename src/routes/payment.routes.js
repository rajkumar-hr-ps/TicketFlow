import { Router } from 'express';
import { getPayments, handlePaymentWebhook } from '../controllers/payment.controller.js';
import { auth } from '../middleware/auth.js';

export const router = Router();

// Webhook endpoint (no auth — uses HMAC signature verification)
router.post('/webhook', handlePaymentWebhook);

// Order payments (auth required)
router.get('/orders/:id/payments', auth, getPayments);
