import { Ticket, TicketStatus } from '../../models/Ticket.js';
import { Event } from '../../models/Event.js';
import { User } from '../../models/User.js';

export const transferTicket = async (req, res) => {
  const ticketId = req.params.id;
  const fromUserId = req.user._id;
  const { to_email } = req.body;

  if (!to_email) {
    return res.status(400).json({ error: 'to_email is required' });
  }

  const ticket = await Ticket.findOneActive({ _id: ticketId, user_id: fromUserId });
  if (!ticket) {
    return res.status(404).json({ error: 'ticket not found' });
  }

  // 1. Validate ticket is transferable
  if (ticket.status !== TicketStatus.CONFIRMED) {
    return res.status(400).json({ error: 'only confirmed tickets can be transferred' });
  }

  // 2. Check event hasn't started
  const event = await Event.findOneActive({ _id: ticket.event_id });
  if (!event) {
    return res.status(400).json({ error: 'event not found' });
  }
  if (new Date(event.start_date) <= new Date()) {
    return res.status(400).json({ error: 'cannot transfer tickets for events that have started' });
  }

  // 3. Find and verify recipient
  const toUser = await User.findOneActive({ email: to_email.toLowerCase() });
  if (!toUser) {
    return res.status(404).json({ error: 'recipient user not found' });
  }

  // 4. Prevent self-transfer
  if (toUser._id.toString() === fromUserId.toString()) {
    return res.status(400).json({ error: 'cannot transfer ticket to yourself' });
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

  return res.json({
    transfer_id: `xfer_${ticket._id}_${newTicket._id}`,
    original_ticket_id: ticket._id,
    new_ticket_id: newTicket._id,
    from_user: fromUserId,
    to_user: toUser._id,
    to_email: to_email.toLowerCase(),
    transferred_at: ticket.transferred_at,
  });
};
