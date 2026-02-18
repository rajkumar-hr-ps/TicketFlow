import * as eventService from '../services/event.service.js';

export const createEvent = async (req, res) => {
  const event = await eventService.createEvent(req.user._id, req.body);
  res.status(201).json({ event });
};

export const getEvents = async (req, res) => {
  const result = await eventService.getEvents(req.query);
  res.json(result);
};

export const getEventById = async (req, res) => {
  const result = await eventService.getEventById(req.params.id);
  res.json(result);
};

export const updateEventStatus = async (req, res) => {
  const { status } = req.body;
  const result = await eventService.updateEventStatus(req.params.id, status, req.user._id);
  // If result has orders_processed, it's a cancellation cascade
  if (result.orders_processed !== undefined) {
    return res.json(result);
  }
  res.json({ event: result });
};
