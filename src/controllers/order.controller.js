import * as orderService from '../services/order.service.js';

export const createOrder = async (req, res) => {
  const result = await orderService.createOrder(req.user._id, req.body);
  res.status(201).json(result);
};

export const getUserOrders = async (req, res) => {
  const orders = await orderService.getUserOrders(req.user._id);
  res.json({ orders });
};

export const getOrderById = async (req, res) => {
  const order = await orderService.getOrderById(req.params.id, req.user._id);
  res.json({ order });
};

export const processRefund = async (req, res) => {
  const result = await orderService.processRefund(req.params.id, req.user._id);
  res.json(result);
};
