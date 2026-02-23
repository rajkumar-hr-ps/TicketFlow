import * as orderService from '../services/order.service.js';
import { processRefund as processRefundService } from '../services/refund.service.js';

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

// WARNING: This route conflicts with features/refund_processing/routes.js
// which also mounts POST /:id/refund on /orders. Resolve the duplication
// before enabling both — currently the feature route takes precedence
// since it is mounted after this in routes/index.js.
export const processRefund = async (req, res) => {
  const result = await processRefundService(req.params.id, req.user._id);
  res.json(result);
};
