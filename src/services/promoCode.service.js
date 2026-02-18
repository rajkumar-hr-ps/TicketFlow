import { PromoCode } from '../models/PromoCode.js';
import { BadRequestError, NotFoundError } from '../utils/AppError.js';

export const createPromoCode = async (data) => {
  const {
    code, event_id, discount_type, discount_value,
    max_uses, valid_from, valid_to, min_tickets, max_discount_amount,
  } = data;

  if (!code || !discount_type || !discount_value || !max_uses || !valid_from || !valid_to) {
    throw new BadRequestError('code, discount_type, discount_value, max_uses, valid_from, and valid_to are required');
  }

  if (discount_type === 'percentage' && (discount_value <= 0 || discount_value > 100)) {
    throw new BadRequestError('percentage discount_value must be between 1 and 100');
  }

  if (discount_type === 'fixed' && discount_value <= 0) {
    throw new BadRequestError('fixed discount_value must be greater than 0');
  }

  const promo = new PromoCode({
    code: code.toUpperCase(),
    event_id: event_id || null,
    discount_type,
    discount_value,
    max_uses,
    valid_from,
    valid_to,
    min_tickets: min_tickets || 1,
    max_discount_amount: max_discount_amount || null,
  });

  await promo.save();
  return promo;
};

export const validatePromoCode = async (code, eventId = null, quantity = 1) => {
  if (!code) {
    throw new BadRequestError('Promo code is required');
  }

  const promo = await PromoCode.findOneActive({ code: code.toUpperCase() });
  if (!promo) {
    throw new NotFoundError('Promo code not found');
  }

  const now = new Date();

  if (now < new Date(promo.valid_from)) {
    throw new BadRequestError('Promo code is not yet valid');
  }

  if (now > new Date(promo.valid_to)) {
    throw new BadRequestError('Promo code has expired');
  }

  if (promo.current_uses >= promo.max_uses) {
    throw new BadRequestError('Promo code usage limit reached');
  }

  if (promo.event_id && eventId && promo.event_id.toString() !== eventId.toString()) {
    throw new BadRequestError('Promo code is not valid for this event');
  }

  if (quantity < promo.min_tickets) {
    throw new BadRequestError(`Minimum ${promo.min_tickets} tickets required for this promo code`);
  }

  return {
    valid: true,
    promo,
  };
};
