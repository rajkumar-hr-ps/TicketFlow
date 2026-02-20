import jwt from 'jsonwebtoken';
import { User, USER_ROLES } from '../models/User.js';
import { config } from '../config/env.js';
import { BadRequestError, UnauthorizedError, NotFoundError } from '../utils/AppError.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const register = async ({ name, email, password, role }) => {
  if (!name || !email || !password) {
    throw new BadRequestError('Name, email, and password are required');
  }

  if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
    throw new BadRequestError('Name, email, and password must be strings');
  }

  const trimmedName = name.trim();
  if (trimmedName.length < 2 || trimmedName.length > 100) {
    throw new BadRequestError('Name must be between 2 and 100 characters');
  }

  if (!EMAIL_RE.test(email)) {
    throw new BadRequestError('Invalid email format');
  }

  if (password.length < 8) {
    throw new BadRequestError('Password must be at least 8 characters');
  }

  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new BadRequestError('Password must contain at least one uppercase letter, one lowercase letter, and one digit');
  }

  if (role !== undefined && !USER_ROLES.includes(role)) {
    throw new BadRequestError(`Invalid role. Must be one of: ${USER_ROLES.join(', ')}`);
  }

  const existingUser = await User.findOneActive({ email: email.toLowerCase() });
  if (existingUser) {
    throw new BadRequestError('email already exists');
  }

  const user = new User({
    name: trimmedName,
    email: email.toLowerCase(),
    password,
    role: role || 'customer',
  });
  await user.save();

  const token = jwt.sign({ userId: user._id }, config.jwtSecret, { expiresIn: '24h' });

  return {
    message: 'User registered successfully',
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
};

export const login = async ({ email, password }) => {
  if (!email || !password) {
    throw new BadRequestError('Email and password are required');
  }

  if (typeof email !== 'string' || typeof password !== 'string') {
    throw new BadRequestError('Invalid input');
  }

  const user = await User.findOneActive({ email: email.toLowerCase() });
  if (!user) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const token = jwt.sign({ userId: user._id }, config.jwtSecret, { expiresIn: '24h' });

  return {
    token,
    user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
};

export const getUserProfile = async (userId) => {
  const user = await User.findOneActive({ _id: userId }).select('-password');
  if (!user) {
    throw new NotFoundError('User not found');
  }
  return user;
};
