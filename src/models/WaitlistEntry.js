import mongoose from 'mongoose';

export const WAITLIST_STATUSES = ['waiting', 'notified', 'expired', 'converted'];

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

export const WaitlistEntry = mongoose.model('WaitlistEntry', waitlistEntrySchema);
