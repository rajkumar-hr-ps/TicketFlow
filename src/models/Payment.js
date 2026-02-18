import mongoose from 'mongoose';
import { softDeletePlugin } from '../utils/softDelete.plugin.js';

export const PaymentType = {
  PURCHASE: 'purchase',
  REFUND: 'refund',
};

export const PaymentStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const PAYMENT_TYPES = Object.values(PaymentType);
export const PAYMENT_STATUSES = Object.values(PaymentStatus);
export const PAYMENT_METHODS = ['credit_card', 'debit_card', 'wallet'];

const paymentSchema = new mongoose.Schema(
  {
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: PAYMENT_TYPES,
    },
    status: {
      type: String,
      required: true,
      enum: PAYMENT_STATUSES,
      default: 'pending',
    },
    payment_method: {
      type: String,
      enum: PAYMENT_METHODS,
      default: null,
    },
    idempotency_key: {
      type: String,
      required: true,
      unique: true,
    },
    processed_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

paymentSchema.index({ order_id: 1 });
paymentSchema.index({ idempotency_key: 1 }, { unique: true });

paymentSchema.plugin(softDeletePlugin);

export const Payment = mongoose.model('Payment', paymentSchema);
