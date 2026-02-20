import { Event, EventStatus } from '../../models/Event.js';
import { Venue } from '../../models/Venue.js';
import { VenueSection } from '../../models/VenueSection.js';
import { getAvailableSeats } from '../../utils/helpers.js';

export const getEventSchedule = async (req, res) => {
  const { start_date, end_date } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }

  const startDate = new Date(start_date);
  const endDate = new Date(end_date);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'invalid date format' });
  }

  if (endDate <= startDate) {
    return res.status(400).json({ error: 'end_date must be after start_date' });
  }

  const events = await Event.findActive({
    status: { $in: [EventStatus.ON_SALE, EventStatus.SOLD_OUT] },
    start_date: { $gte: startDate, $lte: endDate },
  }).sort({ start_date: 1 });

  const venueIds = [...new Set(events.map((e) => e.venue_id.toString()))];
  const venues = await Venue.find({ _id: { $in: venueIds } });
  const venueMap = new Map(venues.map((v) => [v._id.toString(), v]));

  const eventIds = events.map((e) => e._id);
  const sections = await VenueSection.findActive({ event_id: { $in: eventIds } });

  const sectionsByEvent = {};
  for (const section of sections) {
    const eid = section.event_id.toString();
    if (!sectionsByEvent[eid]) sectionsByEvent[eid] = [];
    sectionsByEvent[eid].push(section);
  }

  const grouped = {};
  for (const event of events) {
    const vid = event.venue_id.toString();
    const venue = venueMap.get(vid);
    if (!grouped[vid]) {
      grouped[vid] = {
        venue_id: vid,
        venue_name: venue?.name || 'Unknown',
        city: venue?.city || 'Unknown',
        events: [],
      };
    }

    const eventSections = sectionsByEvent[event._id.toString()] || [];
    const priceRange = eventSections.length > 0
      ? {
          min: Math.min(...eventSections.map((s) => s.base_price)),
          max: Math.max(...eventSections.map((s) => s.base_price)),
        }
      : { min: 0, max: 0 };
    const totalAvailable = eventSections.reduce(
      (sum, s) => sum + getAvailableSeats(s),
      0
    );

    grouped[vid].events.push({
      event_id: event._id,
      title: event.title,
      category: event.category,
      start_date: event.start_date,
      end_date: event.end_date,
      status: event.status,
      sections_count: eventSections.length,
      total_available: totalAvailable,
      price_range: priceRange,
    });
  }

  return res.json({
    period_start: startDate.toISOString(),
    period_end: endDate.toISOString(),
    venues: Object.values(grouped),
    total_events: events.length,
  });
};
