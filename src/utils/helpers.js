export const DAY_MS = 86_400_000;

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

export function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

export function getAvailableSeats(section) {
  return Math.max(0, section.capacity - section.sold_count - section.held_count);
}

export const idempotencyKey = {
  order: (userId, eventId) => `order_${userId}_${eventId}_${Date.now()}`,
  payment: (orderId) => `payment_${orderId}_${Date.now()}`,
  refund: (orderId) => `refund_${orderId}_${Date.now()}`,
  cancelRefund: (eventId, orderId) => `cancel_refund_${eventId}_${orderId}`,
};
