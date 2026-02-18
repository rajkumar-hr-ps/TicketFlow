import * as authService from '../services/auth.service.js';

export const register = async (req, res) => {
  const result = await authService.register(req.body);
  res.status(201).json(result);
};

export const login = async (req, res) => {
  const result = await authService.login(req.body);
  res.json(result);
};

export const getProfile = async (req, res) => {
  const user = await authService.getUserProfile(req.user._id);
  res.json({ user });
};
