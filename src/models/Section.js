import mongoose from 'mongoose';
import { softDeletePlugin } from '../utils/softDelete.plugin.js';

const sectionSchema = new mongoose.Schema(
  {
    event_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    venue_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Venue',
      required: true,
    },
    name: {
      type: String,
      required: true,
      maxlength: 100,
    },
    capacity: {
      type: Number,
      required: true,
      min: 1,
    },
    base_price: {
      type: Number,
      required: true,
      min: 0,
    },
    sold_count: {
      type: Number,
      default: 0,
    },
    held_count: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

sectionSchema.index({ event_id: 1 });
sectionSchema.index({ venue_id: 1 });

sectionSchema.plugin(softDeletePlugin);

export const Section = mongoose.model('Section', sectionSchema);
