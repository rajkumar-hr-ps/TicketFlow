import { VenueSection } from '../models/VenueSection.js';
import { NotFoundError } from '../utils/AppError.js';
import { roundMoney } from '../utils/helpers.js';

export const PRICING_TIERS = [
  { threshold: 0.90, multiplier: 2.0, label: 'peak' },
  { threshold: 0.75, multiplier: 1.5, label: 'very_high_demand' },
  { threshold: 0.50, multiplier: 1.25, label: 'high_demand' },
  { threshold: 0, multiplier: 1.0, label: 'standard' },
];

export function getPricingTier(sellThroughRatio) {
  for (const tier of PRICING_TIERS) {
    if (sellThroughRatio >= tier.threshold) {
      return tier;
    }
  }
  return PRICING_TIERS[PRICING_TIERS.length - 1];
}

export const SERVICE_FEE_RATE = 0.12;
export const FACILITY_FEE_RATE = 0.05;
export const PROCESSING_FEE = 3.00;

export const REFUND_TIERS = [
  { minHours: 168, percentage: 1.0,  tier: 'full_refund' },
  { minHours: 72,  percentage: 0.75, tier: '75_percent' },
  { minHours: 24,  percentage: 0.50, tier: '50_percent' },
];

export const getRefundTier = (hoursUntilEvent, isOrganizerCancellation) => {
  if (isOrganizerCancellation) {
    return { percentage: 1.0, tier: 'organizer_cancellation' };
  }
  const match = REFUND_TIERS.find((t) => hoursUntilEvent > t.minHours);
  return match ? { percentage: match.percentage, tier: match.tier } : null;
};

export const getDynamicMultiplier = (section) => {
  const sellThrough = section.capacity > 0
    ? section.sold_count / section.capacity
    : 0;
  return getPricingTier(sellThrough);
};

export const calculateTicketPrice = (basePrice, multiplier) => {
  const unitPrice = roundMoney(basePrice * multiplier);
  const serviceFee = roundMoney(unitPrice * SERVICE_FEE_RATE);
  const facilityFee = roundMoney(unitPrice * FACILITY_FEE_RATE);
  return { unitPrice, serviceFee, facilityFee };
};

export const calculateOrderTotal = async (sectionId, quantity, promoCode = null) => {
  const section = await VenueSection.findOneActive({ _id: sectionId });
  if (!section) throw new NotFoundError('section not found');

  const tier = getDynamicMultiplier(section);
  const { unitPrice, serviceFee, facilityFee } = calculateTicketPrice(section.base_price, tier.multiplier);

  const subtotal = roundMoney(unitPrice * quantity);
  const serviceFeeTotal = roundMoney(serviceFee * quantity);
  const facilityFeeTotal = roundMoney(facilityFee * quantity);
  const processingFee = PROCESSING_FEE;

  let discountAmount = 0;
  if (promoCode) {
    if (promoCode.discount_type === 'percentage') {
      discountAmount = roundMoney(subtotal * (promoCode.discount_value / 100));
      if (promoCode.max_discount_amount) {
        discountAmount = Math.min(discountAmount, promoCode.max_discount_amount);
      }
    } else {
      discountAmount = Math.min(promoCode.discount_value, subtotal);
    }
  }

  const totalAmount = roundMoney(
    subtotal + serviceFeeTotal + facilityFeeTotal + processingFee - discountAmount
  );

  return {
    unit_price: unitPrice,
    multiplier: tier.multiplier,
    tier: tier.label,
    subtotal,
    service_fee_per_ticket: serviceFee,
    facility_fee_per_ticket: facilityFee,
    service_fee_total: serviceFeeTotal,
    facility_fee_total: facilityFeeTotal,
    processing_fee: processingFee,
    discount_amount: discountAmount,
    total_amount: totalAmount,
  };
};
