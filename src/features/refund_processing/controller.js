import { processRefundForOrder } from './service.js';

export const processRefund = async (req, res) => {
  const orderId = req.params.id;
  const userId = req.user._id;

  const result = await processRefundForOrder(orderId, userId);

  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result.data);
};
