import crypto from 'crypto';
import { Ticket, TicketStatus } from '../models/Ticket.js';
import { Section } from '../models/Section.js';
import { Event, EventStatus } from '../models/Event.js';
import { User } from '../models/User.js';
import { redisClient } from '../config/redis.js';
import { config } from '../config/env.js';
import { BadRequestError, NotFoundError } from '../utils/AppError.js';
import { holdKey } from './hold.service.js';
import { getAvailableSeats } from '../utils/helpers.js';

// --- Bug 3 Solution: Hold-to-purchase with counter transitions ---
//TODO: NOT IN USE
export const confirmTicketPurchase = async (ticketId) => {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new NotFoundError('ticket not found');

  if (ticket.status !== TicketStatus.HELD) {
    throw new BadRequestError('only held tickets can be confirmed');
  }

  // 1. Transition section counters: held → sold
  const section = await Section.findByIdAndUpdate(
    ticket.section_id,
    { $inc: { held_count: -1, sold_count: 1 } },
    { new: true }
  );

  // 2. Clean up Redis hold key
  await redisClient.del(holdKey(ticket.section_id, ticket._id));

  // 3. Update ticket status
  ticket.status = TicketStatus.CONFIRMED;
  ticket.hold_expires_at = null;
  await ticket.save();

  // 4. Check if section is now sold out
  if (section && getAvailableSeats(section) <= 0) {
    const eventSections = await Section.findActive({ event_id: ticket.event_id });
    const allSoldOut = eventSections.every(
      (s) => getAvailableSeats(s) <= 0
    );
    if (allSoldOut) {
      await Event.findByIdAndUpdate(ticket.event_id, { status: EventStatus.SOLD_OUT });
    }
  }

  return ticket;
};

// --- Bug 5 Solution: Ticket transfer with full ownership chain ---
//TODO: NOT IN USE
export const transferTicket = async (ticketId, fromUserId, toEmail) => {
  const ticket = await Ticket.findOneActive({ _id: ticketId, user_id: fromUserId });
  if (!ticket) {
    throw new NotFoundError('ticket not found or not owned by you');
  }

  // 1. Validate ticket is transferable
  if (ticket.status !== TicketStatus.CONFIRMED) {
    throw new BadRequestError('only confirmed tickets can be transferred');
  }

  // 2. Check event hasn't started
  const event = await Event.findOneActive({ _id: ticket.event_id });
  if (!event) throw new BadRequestError('event not found');
  if (new Date(event.start_date) <= new Date()) {
    throw new BadRequestError('cannot transfer tickets for events that have started');
  }

  // 3. Find and verify recipient
  if (!toEmail) throw new BadRequestError('recipient email is required');
  const toUser = await User.findOneActive({ email: toEmail.toLowerCase() });
  if (!toUser) throw new NotFoundError('recipient user not found');

  // 4. Prevent self-transfer
  if (toUser._id.toString() === fromUserId.toString()) {
    throw new BadRequestError('cannot transfer ticket to yourself');
  }

  // 5. Invalidate original ticket
  ticket.status = TicketStatus.TRANSFERRED;
  ticket.transferred_at = new Date();
  await ticket.save();

  // 6. Create new ticket for recipient
  const newTicket = await Ticket.create({
    order_id: ticket.order_id,
    event_id: ticket.event_id,
    section_id: ticket.section_id,
    user_id: toUser._id,
    original_user_id: ticket.original_user_id,
    status: TicketStatus.CONFIRMED,
    unit_price: ticket.unit_price,
    service_fee: ticket.service_fee,
    facility_fee: ticket.facility_fee,
  });

  return {
    transfer_id: `xfer_${ticket._id}_${newTicket._id}`,
    original_ticket_id: ticket._id,
    new_ticket_id: newTicket._id,
    from_user: fromUserId,
    to_user: toUser._id,
    to_email: toEmail.toLowerCase(),
    transferred_at: ticket.transferred_at,
  };
};

// --- Bug 7 Solution: HMAC barcode generation and verification ---
//TODO: NOT IN USE
export const generateBarcode = (ticketId, userId, eventId) => {
  const payload = {
    tid: ticketId.toString(),
    uid: userId.toString(),
    eid: eventId.toString(),
    iat: Date.now(),
  };

  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');

  const signature = crypto
    .createHmac('sha256', config.barcodeSecret)
    .update(payloadB64)
    .digest('base64url');

  return `${payloadB64}.${signature}`;
};

//TODO: NOT IN USE
export const verifyBarcode = async (barcode) => {
  const parts = barcode.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'invalid barcode format' };
  }

  const [payloadB64, providedSignature] = parts;

  // 1. Verify HMAC signature
  const expectedSignature = crypto
    .createHmac('sha256', config.barcodeSecret)
    .update(payloadB64)
    .digest('base64url');

  try {
    if (!crypto.timingSafeEqual(
      Buffer.from(providedSignature),
      Buffer.from(expectedSignature)
    )) {
      return { valid: false, error: 'invalid signature' };
    }
  } catch {
    return { valid: false, error: 'invalid signature' };
  }

  // 2. Decode payload
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, error: 'invalid barcode payload' };
  }

  // 3. Verify ticket exists and is confirmed
  const ticket = await Ticket.findById(payload.tid);
  if (!ticket || ticket.status !== TicketStatus.CONFIRMED) {
    return { valid: false, error: 'ticket not found or not confirmed' };
  }

  // 4. Verify ownership binding
  if (ticket.user_id.toString() !== payload.uid) {
    return { valid: false, error: 'barcode ownership mismatch' };
  }

  // 5. Track scan count
  ticket.scan_count = (ticket.scan_count || 0) + 1;
  ticket.last_scanned_at = new Date();
  await ticket.save();

  return {
    valid: true,
    ticket_id: payload.tid,
    user_id: payload.uid,
    event_id: payload.eid,
    scan_count: ticket.scan_count,
    warning: ticket.scan_count > 1 ? 'duplicate_scan_detected' : null,
  };
};
