import * as ticketService from '../services/ticket.service.js';

export const confirmTicket = async (req, res) => {
  const ticket = await ticketService.confirmTicketPurchase(req.params.id);
  res.json(ticket);
};

export const generateBarcode = async (req, res) => {
  const result = await ticketService.generateBarcodeForTicket(req.params.id);
  res.json(result);
};

export const verifyBarcode = async (req, res) => {
  const { barcode } = req.body;
  if (!barcode) {
    return res.status(400).json({ error: 'barcode is required' });
  }
  const result = await ticketService.verifyBarcode(barcode);
  res.json(result);
};
