import mongoose from 'mongoose';
import { softDeletePlugin } from '../utils/softDelete.plugin.js';

export const DISCOUNT_TYPES = ['percentage', 'fixed'];

const promoCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    event_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      default: null,
    },
    discount_type: {
      type: String,
      required: true,
      enum: DISCOUNT_TYPES,
    },
    discount_value: {
      type: Number,
      required: true,
      min: 0,
    },
    max_uses: {
      type: Number,
      required: true,
      min: 1,
    },
    current_uses: {
      type: Number,
      default: 0,
    },
    valid_from: {
      type: Date,
      required: true,
    },
    valid_to: {
      type: Date,
      required: true,
    },
    min_tickets: {
      type: Number,
      default: 1,
    },
    max_discount_amount: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

promoCodeSchema.index({ code: 1 }, { unique: true });

promoCodeSchema.plugin(softDeletePlugin);

export const PromoCode = mongoose.model('PromoCode', promoCodeSchema);
