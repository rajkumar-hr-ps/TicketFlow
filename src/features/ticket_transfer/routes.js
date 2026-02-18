import { Router } from 'express';
import { transferTicket } from './controller.js';
import { auth } from '../../middleware/auth.js';

export const router = Router();

router.post('/:id/transfer', auth, transferTicket);
