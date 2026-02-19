import { Router } from 'express';
import { createOrder, getUserOrders, getOrderById, processRefund } from '../controllers/order.controller.js';
import { auth } from '../middleware/auth.js';

export const router = Router();

router.post('/', auth, createOrder);
router.get('/', auth, getUserOrders);
router.get('/:id', auth, getOrderById);

// WARNING: This route conflicts with features/refund_processing/routes.js
// which mounts the same path. The feature route takes precedence in
// routes/index.js since it is mounted after this. Resolve before enabling both.
router.post('/:id/refund', auth, processRefund);
