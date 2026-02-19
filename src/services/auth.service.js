import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { config } from '../config/env.js';
import { BadRequestError, UnauthorizedError, NotFoundError } from '../utils/AppError.js';

export const register = async ({ name, email, password, role }) => {
  if (!name || !email || !password) {
    throw new BadRequestError('Name, email, and password are required');
  }

  const existingUser = await User.findOneActive({ email: email.toLowerCase() });
  if (existingUser) {
    throw new BadRequestError('email already exists');
  }

  const user = new User({
    name,
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
