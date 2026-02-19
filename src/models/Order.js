import mongoose from 'mongoose';
import { softDeletePlugin } from '../utils/softDelete.plugin.js';

export const OrderStatus = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
};

export const OrderPaymentStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
};

export const ORDER_STATUSES = Object.values(OrderStatus);
export const PAYMENT_STATUSES = Object.values(OrderPaymentStatus);

const orderSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    event_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    tickets: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ticket',
    }],
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
    service_fee_total: {
      type: Number,
      default: 0,
    },
    facility_fee_total: {
      type: Number,
      default: 0,
    },
    processing_fee: {
      type: Number,
      default: 3.00,
    },
    discount_amount: {
      type: Number,
      default: 0,
    },
    total_amount: {
      type: Number,
      default: 0,
    },
    promo_code_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PromoCode',
      default: null,
    },
    status: {
      type: String,
      required: true,
      enum: ORDER_STATUSES,
      default: 'pending',
    },
    payment_status: {
      type: String,
      required: true,
      enum: PAYMENT_STATUSES,
      default: 'pending',
    },
    idempotency_key: {
      type: String,
      required: true,
      unique: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

orderSchema.index({ user_id: 1 });
orderSchema.index({ event_id: 1, status: 1 });
orderSchema.index({ idempotency_key: 1 }, { unique: true });

orderSchema.plugin(softDeletePlugin);

export const Order = mongoose.model('Order', orderSchema);
