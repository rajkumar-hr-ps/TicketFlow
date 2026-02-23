import mongoose from 'mongoose';

const webhookLogSchema = new mongoose.Schema(
  {
    webhook_event_id: {
      type: String,
      required: true,
      unique: true,
    },
    payment_id: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      required: true,
    },
    error: {
      type: String,
      default: null,
    },
    expected: {
      type: Number,
      default: null,
    },
    received: {
      type: Number,
      default: null,
    },
    received_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

export const WebhookLog = mongoose.model('WebhookLog', webhookLogSchema);
