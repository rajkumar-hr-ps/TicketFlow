import mongoose from 'mongoose';
import { softDeletePlugin } from '../utils/softDelete.plugin.js';

const venueSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      maxlength: 200,
      trim: true,
    },
    address: {
      type: String,
      required: true,
      maxlength: 500,
    },
    city: {
      type: String,
      required: true,
      maxlength: 100,
    },
    total_capacity: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

venueSchema.plugin(softDeletePlugin);

export const Venue = mongoose.model('Venue', venueSchema);
