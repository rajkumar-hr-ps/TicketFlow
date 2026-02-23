import { Ticket, TicketStatus } from '../models/Ticket.js';
import { VenueSection } from '../models/VenueSection.js';
import { Event, EventStatus } from '../models/Event.js';
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
    { returnDocument: 'after' }
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
      { returnDocument: 'after' }
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

// Re-export barcode functions from barcode.service.js
export { generateBarcodeForTicket, verifyBarcode } from './barcode.service.js';
