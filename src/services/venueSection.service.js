import { VenueSection } from '../models/VenueSection.js';
import { NotFoundError } from '../utils/AppError.js';
import { roundMoney, getAvailableSeats, getSellThroughRatio } from '../utils/helpers.js';
import { getPricingTier } from './pricing.service.js';

export const getSectionsByEvent = async (eventId) => {
  const sections = await VenueSection.findActive({ event_id: eventId });
  return sections.map((s) => ({
    ...s.toObject(),
    available: getAvailableSeats(s),
  }));
};

export const getSectionAvailability = async (eventId, sectionId) => {
  const section = await VenueSection.findOneActive({ _id: sectionId, event_id: eventId });
  if (!section) {
    throw new NotFoundError('Section not found');
  }

  const available = getAvailableSeats(section);
  const sellThrough = getSellThroughRatio(section);
  const tier = getPricingTier(sellThrough);
  const currentPrice = roundMoney(section.base_price * tier.multiplier);

  return {
    section_id: section._id,
    name: section.name,
    capacity: section.capacity,
    sold_count: section.sold_count,
    held_count: section.held_count,
    available,
    sell_through_pct: roundMoney(sellThrough * 100),
    pricing: {
      base_price: section.base_price,
      multiplier: tier.multiplier,
      tier: tier.label,
      current_price: currentPrice,
    },
  };
};
