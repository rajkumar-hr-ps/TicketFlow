import { Router } from 'express';
import { createOrder, getUserOrders, getOrderById, processRefund } from '../controllers/order.controller.js';
import { auth } from '../middleware/auth.js';

export const router = Router();

router.post('/', auth, createOrder);
router.get('/', auth, getUserOrders);
router.get('/:id', auth, getOrderById);

// Simple refund route — full refund only, no partial support.
// The feature route at features/refund_processing handles POST /:id/refund with partial refund support.
// TODO: Decide whether to keep or remove this route.
router.post('/:id/simple-refund', auth, processRefund);
