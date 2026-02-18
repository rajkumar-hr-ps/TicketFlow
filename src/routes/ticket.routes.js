import { Router } from 'express';
import { confirmTicket, generateBarcode, verifyBarcode } from '../controllers/ticket.controller.js';
import { auth } from '../middleware/auth.js';

export const router = Router();

router.post('/verify-barcode', auth, verifyBarcode);
router.post('/:id/confirm', auth, confirmTicket);
router.post('/:id/barcode', auth, generateBarcode);
