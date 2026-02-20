import crypto from 'crypto';
import { Ticket, TicketStatus } from '../models/Ticket.js';
import { VenueSection } from '../models/VenueSection.js';
import { Event, EventStatus } from '../models/Event.js';
import { config } from '../config/env.js';
import { BadRequestError, NotFoundError } from '../utils/AppError.js';
import { removeHold } from './hold.service.js';
import { getAvailableSeats } from '../utils/helpers.js';

// --- Bug 3 Solution: Hold-to-purchase with counter transitions ---
export const confirmTicketPurchase = async (ticketId) => {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new NotFoundError('ticket not found');

  if (ticket.status !== TicketStatus.HELD) {
    throw new BadRequestError('only held tickets can be confirmed');
  }

  // 1. Transition section counters: held → sold
  const section = await VenueSection.findByIdAndUpdate(
    ticket.section_id,
    { $inc: { held_count: -1, sold_count: 1 } },
    { new: true }
  );

  // 2. Clean up Redis hold key
  await removeHold(ticket.section_id, ticket._id);

  // 3. Update ticket status
  ticket.status = TicketStatus.CONFIRMED;
  ticket.hold_expires_at = null;
  await ticket.save();

  // 4. Check if section is now sold out
  if (section && getAvailableSeats(section) <= 0) {
    const eventSections = await VenueSection.findActive({ event_id: ticket.event_id });
    const allSoldOut = eventSections.every(
      (s) => getAvailableSeats(s) <= 0
    );
    if (allSoldOut) {
      await Event.findByIdAndUpdate(ticket.event_id, { status: EventStatus.SOLD_OUT });
    }
  }

  return ticket;
};

// --- Batch confirm all held tickets for an order ---
export const confirmOrderTickets = async (orderId) => {
  const tickets = await Ticket.find({
    order_id: orderId,
    status: TicketStatus.HELD,
    deleted_at: null,
  });
  if (tickets.length === 0) return;

  // 1. Update all ticket statuses
  await Ticket.updateMany(
    { _id: { $in: tickets.map((t) => t._id) } },
    { $set: { status: TicketStatus.CONFIRMED, hold_expires_at: null } }
  );

  // 2. Aggregate section counts and transition counters + clean Redis holds
  const sectionCounts = {};
  for (const ticket of tickets) {
    const sid = ticket.section_id.toString();
    sectionCounts[sid] = (sectionCounts[sid] || 0) + 1;
    await removeHold(ticket.section_id, ticket._id);
  }

  const updatedSections = [];
  for (const [sectionId, count] of Object.entries(sectionCounts)) {
    const section = await VenueSection.findByIdAndUpdate(
      sectionId,
      { $inc: { held_count: -count, sold_count: count } },
      { new: true }
    );
    if (section) updatedSections.push(section);
  }

  // 3. Check if all sections for the event are sold out
  const eventId = tickets[0].event_id;
  const eventSections = await VenueSection.findActive({ event_id: eventId });
  const allSoldOut = eventSections.every((s) => getAvailableSeats(s) <= 0);
  if (allSoldOut) {
    await Event.findByIdAndUpdate(eventId, { status: EventStatus.SOLD_OUT });
  }
};

// --- Bug 7 Solution: HMAC barcode generation and verification ---
export const generateBarcodeForTicket = async (ticketId) => {
  const ticket = await Ticket.findOneActive({ _id: ticketId });
  if (!ticket) throw new NotFoundError('ticket not found');
  return { barcode: generateBarcode(ticket._id, ticket.user_id, ticket.event_id) };
};

const generateBarcode = (ticketId, userId, eventId) => {
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
