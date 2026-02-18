import { Router } from 'express';
import { createOrder, getUserOrders, getOrderById, processRefund } from '../controllers/order.controller.js';
import { auth } from '../middleware/auth.js';

export const router = Router();

router.post('/', auth, createOrder);
router.get('/', auth, getUserOrders);
router.get('/:id', auth, getOrderById);
router.post('/:id/refund', auth, processRefund);
