import { Event, EventStatus, EVENT_STATUSES, EVENT_CATEGORIES, VALID_TRANSITIONS } from '../models/Event.js';
import { VenueSection } from '../models/VenueSection.js';
import { Venue } from '../models/Venue.js';
import { BadRequestError, NotFoundError, ConflictError } from '../utils/AppError.js';
import * as cacheService from './cache.service.js';
import { cancelEvent } from './cancellation.service.js';
import { getAvailableSeats, isValidDate } from '../utils/helpers.js';

const BUFFER_HOURS = 4;

// --- Bug 6 Solution: Venue availability with range overlap ---
export const checkVenueAvailability = async (venueId, startDate, endDate, excludeEventId = null) => {
  const requestedStart = new Date(startDate);
  const requestedEnd = new Date(endDate);

  if (requestedEnd <= requestedStart) {
    throw new BadRequestError('end_date must be after start_date');
  }

  const bufferedStart = new Date(requestedStart.getTime() - BUFFER_HOURS * 60 * 60 * 1000);
  const bufferedEnd = new Date(requestedEnd.getTime() + BUFFER_HOURS * 60 * 60 * 1000);

  const query = {
    venue_id: venueId,
    status: { $nin: [EventStatus.CANCELLED, EventStatus.DRAFT] },
    start_date: { $lt: bufferedEnd },
    end_date: { $gt: bufferedStart },
  };

  if (excludeEventId) {
    query._id = { $ne: excludeEventId };
  }

  const conflicts = await Event.findActive(query).select('title start_date end_date');

  if (conflicts.length > 0) {
    const conflictList = conflicts.map((c) => ({
      event_id: c._id,
      title: c.title,
      start_date: c.start_date,
      end_date: c.end_date,
    }));
    return {
      available: false,
      conflicts: conflictList,
      buffer_hours: BUFFER_HOURS,
    };
  }

  return { available: true, conflicts: [], buffer_hours: BUFFER_HOURS };
};

// --- Create Event with sections ---
export const createEvent = async (userId, data) => {
  const { title, description, venue_id, start_date, end_date, category, sections } = data;

  if (!title || !venue_id || !start_date || !end_date || !category) {
    throw new BadRequestError('title, venue_id, start_date, end_date, and category are required');
  }

  if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 300) {
    throw new BadRequestError('title must be a string between 1 and 300 characters');
  }

  if (description !== undefined && description !== null && description !== '') {
    if (typeof description !== 'string' || description.length > 2000) {
      throw new BadRequestError('description must be a string of at most 2000 characters');
    }
  }

  if (!isValidDate(start_date) || !isValidDate(end_date)) {
    throw new BadRequestError('start_date and end_date must be valid dates');
  }

  if (new Date(end_date) <= new Date(start_date)) {
    throw new BadRequestError('end_date must be after start_date');
  }

  if (new Date(start_date) <= new Date()) {
    throw new BadRequestError('start_date must be in the future');
  }

  if (!EVENT_CATEGORIES.includes(category)) {
    throw new BadRequestError(`category must be one of: ${EVENT_CATEGORIES.join(', ')}`);
  }

  if (sections && Array.isArray(sections)) {
    for (const s of sections) {
      if (!s.name || typeof s.name !== 'string' || s.name.trim().length < 1) {
        throw new BadRequestError('each section must have a non-empty name');
      }
      if (typeof s.capacity !== 'number' || !Number.isInteger(s.capacity) || s.capacity < 1) {
        throw new BadRequestError('each section capacity must be a positive integer');
      }
      if (typeof s.base_price !== 'number' || s.base_price < 0) {
        throw new BadRequestError('each section base_price must be a non-negative number');
      }
    }
  }

  const venue = await Venue.findOneActive({ _id: venue_id });
  if (!venue) {
    throw new NotFoundError('Venue not found');
  }

  // Check venue availability (Bug 6 solution)
  const availability = await checkVenueAvailability(venue_id, start_date, end_date);
  if (!availability.available) {
    throw new ConflictError('venue not available — scheduling conflict');
  }

  const event = new Event({
    title,
    description,
    venue_id,
    organizer_id: userId,
    start_date,
    end_date,
    category,
    status: EventStatus.DRAFT,
  });
  await event.save();

  // Create sections if provided
  if (sections && Array.isArray(sections) && sections.length > 0) {
    const sectionDocs = sections.map((s) => ({
      event_id: event._id,
      venue_id,
      name: s.name,
      capacity: s.capacity,
      base_price: s.base_price,
    }));
    await VenueSection.insertMany(sectionDocs);
  }

  await cacheService.invalidateCache('events:*');

  return event;
};

// --- Get Events ---
export const getEvents = async (filters = {}) => {
  const { status, category, venue_id, page = 1, limit = 20 } = filters;

  const cacheKey = `events:list:${JSON.stringify(filters)}`;
  const cached = await cacheService.getCache(cacheKey);
  if (cached) return cached;

  const query = {};
  if (status) {
    const statuses = status.split(',');
    query.status = statuses.length > 1 ? { $in: statuses } : status;
  }
  if (category) query.category = category;
  if (venue_id) query.venue_id = venue_id;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [events, total] = await Promise.all([
    Event.findActive(query).sort({ start_date: 1 }).skip(skip).limit(limitNum).lean(),
    Event.countActive(query),
  ]);

  const result = {
    events,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      hasNextPage: pageNum < Math.ceil(total / limitNum),
      hasPrevPage: pageNum > 1,
    },
  };

  await cacheService.setCache(cacheKey, result, cacheService.CACHE_TTL.EVENTS_LIST);

  return result;
};

// --- Get Event By ID ---
export const getEventById = async (eventId) => {
  const event = await Event.findOneActive({ _id: eventId });
  if (!event) {
    throw new NotFoundError('Event not found');
  }

  const sections = await VenueSection.findActive({ event_id: eventId });
  const sectionsWithAvailability = sections.map((s) => ({
    ...s.toObject(),
    available: getAvailableSeats(s),
  }));

  return { event, sections: sectionsWithAvailability };
};

// --- Bug 2 Solution: Event status state machine ---
export const updateEventStatus = async (eventId, newStatus, userId) => {
  if (!newStatus || typeof newStatus !== 'string') {
    throw new BadRequestError('status is required and must be a string');
  }

  if (!EVENT_STATUSES.includes(newStatus)) {
    throw new BadRequestError(`invalid status. Must be one of: ${EVENT_STATUSES.join(', ')}`);
  }

  const event = await Event.findOneActive({ _id: eventId, organizer_id: userId });
  if (!event) {
    throw new NotFoundError('event not found or unauthorized');
  }

  const allowedTransitions = VALID_TRANSITIONS[event.status];
  if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
    throw new BadRequestError(
      `cannot transition from '${event.status}' to '${newStatus}'`
    );
  }

  if (newStatus === EventStatus.PUBLISHED) {
    const sectionCount = await VenueSection.countActive({ event_id: eventId });
    if (sectionCount === 0) {
      throw new BadRequestError('cannot publish event without sections');
    }
  }

  if (newStatus === EventStatus.ON_SALE && event.status === EventStatus.SOLD_OUT) {
    const sections = await VenueSection.findActive({ event_id: eventId });
    const hasAvailable = sections.some((s) => getAvailableSeats(s) > 0);
    if (!hasAvailable) {
      throw new BadRequestError('cannot set on_sale when no seats are available');
    }
  }

  if (newStatus === EventStatus.COMPLETED) {
    if (new Date(event.end_date) > new Date()) {
      throw new BadRequestError('cannot complete event before its end date');
    }
  }

  // Handle cancellation cascade (Bug 9)
  if (newStatus === EventStatus.CANCELLED) {
    return cancelEvent(eventId, userId);
  }

  event.status = newStatus;
  await event.save();

  await cacheService.invalidateCache('events:*');

  return event;
};

