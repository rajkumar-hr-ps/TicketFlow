import mongoose from 'mongoose';
import { softDeletePlugin } from '../utils/softDelete.plugin.js';

export const WaitlistStatus = {
  WAITING: 'waiting',
  NOTIFIED: 'notified',
  EXPIRED: 'expired',
  CONVERTED: 'converted',
};

export const WAITLIST_STATUSES = Object.values(WaitlistStatus);

const waitlistEntrySchema = new mongoose.Schema(
  {
    event_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    position: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: WAITLIST_STATUSES,
      default: 'waiting',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

waitlistEntrySchema.index({ event_id: 1, user_id: 1 });
waitlistEntrySchema.index({ event_id: 1, position: 1 });

waitlistEntrySchema.plugin(softDeletePlugin);

export const WaitlistEntry = mongoose.model('WaitlistEntry', waitlistEntrySchema);
