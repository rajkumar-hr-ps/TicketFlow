import * as venueService from '../services/venue.service.js';

export const createVenue = async (req, res) => {
  const venue = await venueService.createVenue(req.body);
  res.status(201).json({ venue });
};

export const getVenues = async (req, res) => {
  const venues = await venueService.getVenues();
  res.json({ venues });
};

export const getVenueById = async (req, res) => {
  const venue = await venueService.getVenueById(req.params.id);
  res.json({ venue });
};
