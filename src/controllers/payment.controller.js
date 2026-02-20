import * as paymentService from '../services/payment.service.js';

export const getPayments = async (req, res) => {
  const payments = await paymentService.getPaymentsByOrder(req.params.id);
  res.json({ payments });
};

export const handlePaymentWebhook = async (req, res) => {
  const result = await paymentService.processWebhook(req.body);
  res.json(result);
};
