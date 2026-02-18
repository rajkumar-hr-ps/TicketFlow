import { Venue } from '../models/Venue.js';
import { BadRequestError, NotFoundError } from '../utils/AppError.js';
import * as cacheService from './cache.service.js';

export const createVenue = async (data) => {
  if (!data.name || !data.address || !data.city || !data.total_capacity) {
    throw new BadRequestError('name, address, city, and total_capacity are required');
  }

  const venue = new Venue(data);
  await venue.save();

  await cacheService.invalidateCache('venues:*');

  return venue;
};

export const getVenues = async () => {
  const cached = await cacheService.getCache('venues:all');
  if (cached) return cached;

  const venues = await Venue.findActive().sort({ created_at: -1 });

  await cacheService.setCache('venues:all', venues, 300);

  return venues;
};

export const getVenueById = async (venueId) => {
  const venue = await Venue.findOneActive({ _id: venueId });
  if (!venue) {
    throw new NotFoundError('Venue not found');
  }
  return venue;
};
