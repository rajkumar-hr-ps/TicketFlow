import crypto from 'crypto';
import { Ticket, TicketStatus } from '../models/Ticket.js';
import { config } from '../config/env.js';
import { NotFoundError, BadRequestError } from '../utils/AppError.js';

// --- Bug 7 Solution: HMAC barcode generation and verification ---
export const generateBarcodeForTicket = async (ticketId, userId) => {
  const query = { _id: ticketId };
  if (userId) query.user_id = userId;
  const ticket = await Ticket.findOneActive(query);
  if (!ticket) throw new NotFoundError('ticket not found');
  if (ticket.status !== TicketStatus.CONFIRMED) {
    throw new BadRequestError('barcode can only be generated for confirmed tickets');
  }
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
