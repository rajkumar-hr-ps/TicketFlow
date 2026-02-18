export const DAY_MS = 86_400_000;

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
