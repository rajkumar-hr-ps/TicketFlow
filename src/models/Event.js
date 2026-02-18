import mongoose from 'mongoose';
import { softDeletePlugin } from '../utils/softDelete.plugin.js';

export const EventStatus = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  ON_SALE: 'on_sale',
  SOLD_OUT: 'sold_out',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export const EVENT_STATUSES = Object.values(EventStatus);
export const EVENT_CATEGORIES = ['concert', 'sports', 'theater', 'conference', 'festival', 'comedy'];

export const VALID_TRANSITIONS = {
  [EventStatus.DRAFT]: [EventStatus.PUBLISHED],
  [EventStatus.PUBLISHED]: [EventStatus.ON_SALE, EventStatus.CANCELLED],
  [EventStatus.ON_SALE]: [EventStatus.SOLD_OUT, EventStatus.COMPLETED, EventStatus.CANCELLED],
  [EventStatus.SOLD_OUT]: [EventStatus.ON_SALE, EventStatus.COMPLETED, EventStatus.CANCELLED],
  [EventStatus.COMPLETED]: [],
  [EventStatus.CANCELLED]: [],
};

const eventSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      maxlength: 300,
      trim: true,
    },
    description: {
      type: String,
      maxlength: 2000,
      default: '',
    },
    venue_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Venue',
      required: true,
    },
    organizer_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    start_date: {
      type: Date,
      required: true,
    },
    end_date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: EVENT_STATUSES,
      default: 'draft',
    },
    category: {
      type: String,
      required: true,
      enum: EVENT_CATEGORIES,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

eventSchema.index({ venue_id: 1, start_date: 1 });
eventSchema.index({ status: 1 });
eventSchema.index({ organizer_id: 1 });

eventSchema.plugin(softDeletePlugin);

export const Event = mongoose.model('Event', eventSchema);
