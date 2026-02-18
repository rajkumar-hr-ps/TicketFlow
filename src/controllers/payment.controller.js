import * as paymentService from '../services/payment.service.js';

export const getPayments = async (req, res) => {
  const payments = await paymentService.getPaymentsByOrder(req.params.id);
  res.json({ payments });
};

export const handlePaymentWebhook = async (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const result = await paymentService.processWebhook(signature, req.body);
  res.json(result);
};
