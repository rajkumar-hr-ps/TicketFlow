import * as ticketService from '../services/ticket.service.js';

export const confirmTicket = async (req, res) => {
  const ticket = await ticketService.confirmTicketPurchase(req.params.id);
  res.json(ticket);
};

export const generateBarcode = async (req, res) => {
  const { Ticket } = await import('../models/Ticket.js');
  const ticket = await Ticket.findById(req.params.id);
  if (!ticket) {
    return res.status(404).json({ error: 'ticket not found' });
  }
  const barcode = ticketService.generateBarcode(ticket._id, ticket.user_id, ticket.event_id);
  res.json({ barcode });
};

export const verifyBarcode = async (req, res) => {
  const { barcode } = req.body;
  if (!barcode) {
    return res.status(400).json({ error: 'barcode is required' });
  }
  const result = await ticketService.verifyBarcode(barcode);
  res.json(result);
};
