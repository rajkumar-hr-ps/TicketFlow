import { PromoCode, DISCOUNT_TYPES } from '../models/PromoCode.js';
import { BadRequestError, NotFoundError } from '../utils/AppError.js';
import { isValidDate } from '../utils/helpers.js';

export const createPromoCode = async (data) => {
  const {
    code, event_id, discount_type, discount_value,
    max_uses, valid_from, valid_to, min_tickets, max_discount_amount,
  } = data;

  if (!code || !discount_type || !discount_value || !max_uses || !valid_from || !valid_to) {
    throw new BadRequestError('code, discount_type, discount_value, max_uses, valid_from, and valid_to are required');
  }

  if (typeof code !== 'string' || code.trim().length < 1 || code.trim().length > 50) {
    throw new BadRequestError('code must be a string between 1 and 50 characters');
  }

  if (!DISCOUNT_TYPES.includes(discount_type)) {
    throw new BadRequestError(`discount_type must be one of: ${DISCOUNT_TYPES.join(', ')}`);
  }

  if (typeof discount_value !== 'number' || discount_value <= 0) {
    throw new BadRequestError('discount_value must be a positive number');
  }

  if (discount_type === 'percentage' && discount_value > 100) {
    throw new BadRequestError('percentage discount_value must be between 1 and 100');
  }

  if (typeof max_uses !== 'number' || !Number.isInteger(max_uses) || max_uses < 1) {
    throw new BadRequestError('max_uses must be a positive integer');
  }

  if (!isValidDate(valid_from) || !isValidDate(valid_to)) {
    throw new BadRequestError('valid_from and valid_to must be valid dates');
  }

  if (new Date(valid_to) <= new Date(valid_from)) {
    throw new BadRequestError('valid_to must be after valid_from');
  }

  if (min_tickets !== undefined && (typeof min_tickets !== 'number' || !Number.isInteger(min_tickets) || min_tickets < 1)) {
    throw new BadRequestError('min_tickets must be a positive integer');
  }

  if (max_discount_amount !== undefined && max_discount_amount !== null) {
    if (typeof max_discount_amount !== 'number' || max_discount_amount <= 0) {
      throw new BadRequestError('max_discount_amount must be a positive number');
    }
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
