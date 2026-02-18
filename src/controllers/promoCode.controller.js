import * as promoCodeService from '../services/promoCode.service.js';

export const createPromoCode = async (req, res) => {
  const promo = await promoCodeService.createPromoCode(req.body);
  res.status(201).json({ promo });
};

export const validatePromoCode = async (req, res) => {
  const { code } = req.params;
  const { event_id, quantity } = req.query;
  const result = await promoCodeService.validatePromoCode(code, event_id, parseInt(quantity, 10) || 1);
  res.json(result);
};
