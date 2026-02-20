import { Venue } from '../models/Venue.js';
import { BadRequestError, NotFoundError } from '../utils/AppError.js';
import * as cacheService from './cache.service.js';

export const createVenue = async (data) => {
  const { name, address, city, total_capacity } = data;

  if (!name || !address || !city || !total_capacity) {
    throw new BadRequestError('name, address, city, and total_capacity are required');
  }

  if (typeof name !== 'string' || typeof address !== 'string' || typeof city !== 'string') {
    throw new BadRequestError('name, address, and city must be strings');
  }

  const trimmedName = name.trim();
  const trimmedCity = city.trim();

  if (trimmedName.length < 1 || trimmedName.length > 200) {
    throw new BadRequestError('name must be between 1 and 200 characters');
  }

  if (address.trim().length < 1 || address.trim().length > 500) {
    throw new BadRequestError('address must be between 1 and 500 characters');
  }

  if (trimmedCity.length < 1 || trimmedCity.length > 100) {
    throw new BadRequestError('city must be between 1 and 100 characters');
  }

  if (typeof total_capacity !== 'number' || !Number.isInteger(total_capacity) || total_capacity < 1) {
    throw new BadRequestError('total_capacity must be a positive integer');
  }

  const venue = new Venue({ ...data, name: trimmedName, city: trimmedCity });
  await venue.save();

  await cacheService.invalidateCache('venues:*');

  return venue;
};

export const getVenues = async () => {
  const cached = await cacheService.getCache('venues:all');
  if (cached) return cached;

  const venues = await Venue.findActive().sort({ created_at: -1 });

  await cacheService.setCache('venues:all', venues, cacheService.CACHE_TTL.VENUES);

  return venues;
};

export const getVenueById = async (venueId) => {
  const venue = await Venue.findOneActive({ _id: venueId });
  if (!venue) {
    throw new NotFoundError('Venue not found');
  }
  return venue;
};
