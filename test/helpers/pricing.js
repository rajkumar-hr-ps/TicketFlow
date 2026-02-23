/**
 * Shared pricing computation helpers for anti-cheat test randomization.
 * Mirrors the source pricing formulas in src/services/pricing.service.js exactly.
 */

// --- Constants (must match src/services/pricing.service.js) ---
export const SERVICE_FEE_RATE = 0.12;
export const FACILITY_FEE_RATE = 0.05;
export const PROCESSING_FEE = 3.0;

export const PRICING_TIERS = [
  { threshold: 0.9, multiplier: 2.0, label: 'peak' },
  { threshold: 0.75, multiplier: 1.5, label: 'very_high_demand' },
  { threshold: 0.5, multiplier: 1.25, label: 'high_demand' },
  { threshold: 0, multiplier: 1.0, label: 'standard' },
];

// --- Random value generators ---

/** Random integer in [min, max] inclusive */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random integer price in [min, max] — uses integers to avoid floating-point issues */
export function randomPrice(min, max) {
  return randomInt(min, max);
}

// --- Core pricing formulas (mirrors source exactly) ---

export function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

/** Returns { multiplier, tier } based on sell-through ratio */
export function getDemandMultiplier(soldCount, capacity) {
  const ratio = capacity > 0 ? soldCount / capacity : 0;
  for (const t of PRICING_TIERS) {
    if (ratio >= t.threshold) {
      return { multiplier: t.multiplier, tier: t.label };
    }
  }
  return { multiplier: 1.0, tier: 'standard' };
}

/** Returns { unitPrice, serviceFee, facilityFee } for a single ticket */
export function computeTicketPrice(basePrice, multiplier) {
  const unitPrice = roundMoney(basePrice * multiplier);
  const serviceFee = roundMoney(unitPrice * SERVICE_FEE_RATE);
  const facilityFee = roundMoney(unitPrice * FACILITY_FEE_RATE);
  return { unitPrice, serviceFee, facilityFee };
}

/** Full dynamic price with urgency: unitPrice = roundMoney(basePrice * demand * urgency) */
export function computeDynamicUnitPrice(basePrice, demandMultiplier, urgencyMultiplier) {
  return roundMoney(basePrice * demandMultiplier * urgencyMultiplier);
}

/** Returns all order total fields */
export function computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity, discountAmount = 0 }) {
  const subtotal = roundMoney(unitPrice * quantity);
  const serviceFeeTotal = roundMoney(serviceFee * quantity);
  const facilityFeeTotal = roundMoney(facilityFee * quantity);
  const totalAmount = roundMoney(
    subtotal + serviceFeeTotal + facilityFeeTotal + PROCESSING_FEE - discountAmount
  );
  return {
    subtotal,
    serviceFeeTotal,
    facilityFeeTotal,
    processingFee: PROCESSING_FEE,
    discountAmount,
    totalAmount,
  };
}

/**
 * Compute refund amounts.
 * @param {number} unitPrice - per-ticket unit price
 * @param {number} facilityFee - per-ticket facility fee
 * @param {number} ticketCount - number of tickets being refunded
 * @param {number} refundFraction - decimal fraction (0-1), e.g. 1.0, 0.75, 0.50
 * @param {boolean} isOrganizerCancel - if true, facility fees are also refunded
 */
export function computeRefundAmount(unitPrice, facilityFee, ticketCount, refundFraction, isOrganizerCancel = false) {
  const baseTotal = unitPrice * ticketCount;
  const baseRefund = roundMoney(baseTotal * refundFraction);
  const facilityFeeRefund = isOrganizerCancel ? roundMoney(facilityFee * ticketCount) : 0;
  const refundAmount = baseRefund + facilityFeeRefund;
  return { baseRefund, facilityFeeRefund, refundAmount };
}

/**
 * Generate a sold_count that falls within a specific pricing tier.
 * Uses safe ranges to avoid boundary issues.
 */
export function soldCountForTier(capacity, tier) {
  switch (tier) {
    case 'standard':
      return randomInt(1, Math.floor(capacity * 0.48));
    case 'high_demand':
      return randomInt(Math.ceil(capacity * 0.51), Math.floor(capacity * 0.73));
    case 'very_high_demand':
      return randomInt(Math.ceil(capacity * 0.76), Math.floor(capacity * 0.88));
    case 'peak':
      return randomInt(Math.ceil(capacity * 0.91), Math.floor(capacity * 0.97));
    default:
      return randomInt(1, Math.floor(capacity * 0.48));
  }
}

/** Urgency multiplier based on hours until event */
export function getUrgencyMultiplier(hoursUntilEvent) {
  if (hoursUntilEvent <= 24) return 1.5;
  if (hoursUntilEvent <= 48) return 1.4;
  if (hoursUntilEvent <= 7 * 24) return 1.3;
  if (hoursUntilEvent <= 14 * 24) return 1.2;
  if (hoursUntilEvent <= 30 * 24) return 1.1;
  return 1.0;
}

/** Quantity discount percentage */
export function getQuantityDiscountPct(quantity) {
  if (quantity >= 10) return 10;
  if (quantity >= 5) return 5;
  return 0;
}
