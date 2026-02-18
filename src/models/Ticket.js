import mongoose from 'mongoose';
import { softDeletePlugin } from '../utils/softDelete.plugin.js';

export const TicketStatus = {
  HELD: 'held',
  CONFIRMED: 'confirmed',
  USED: 'used',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
  TRANSFERRED: 'transferred',
};

export const TICKET_STATUSES = Object.values(TicketStatus);

const ticketSchema = new mongoose.Schema(
  {
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    event_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    section_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Section',
      required: true,
    },
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    original_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: TICKET_STATUSES,
      default: 'held',
    },
    unit_price: {
      type: Number,
      required: true,
    },
    service_fee: {
      type: Number,
      required: true,
    },
    facility_fee: {
      type: Number,
      required: true,
    },
    hold_expires_at: {
      type: Date,
      default: null,
    },
    transferred_at: {
      type: Date,
      default: null,
    },
    scan_count: {
      type: Number,
      default: 0,
    },
    last_scanned_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

ticketSchema.index({ order_id: 1 });
ticketSchema.index({ event_id: 1, status: 1 });
ticketSchema.index({ user_id: 1 });
ticketSchema.index({ section_id: 1, status: 1 });

ticketSchema.plugin(softDeletePlugin);

export const Ticket = mongoose.model('Ticket', ticketSchema);
