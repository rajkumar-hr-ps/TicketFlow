import { Router } from 'express';
import { register, login, getProfile } from '../controllers/auth.controller.js';
import { auth } from '../middleware/auth.js';

export const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', auth, getProfile);
