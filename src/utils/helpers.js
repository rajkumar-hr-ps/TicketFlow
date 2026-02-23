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
  cancelRefund: (eventId, orderId) => `cancel_refund_${eventId}_${orderId}_${Date.now()}`,
};

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidDate(v) {
  return !isNaN(new Date(v).getTime());
}

export function getHoursUntil(date) {
  return (new Date(date) - new Date()) / (1000 * 60 * 60);
}

export function getSellThroughRatio(section) {
  return section.capacity > 0 ? section.sold_count / section.capacity : 0;
}
