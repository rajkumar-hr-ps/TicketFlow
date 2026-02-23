import { VenueSection } from '../../models/VenueSection.js';
import { Event } from '../../models/Event.js';
import { roundMoney, getAvailableSeats, getSellThroughRatio } from '../../utils/helpers.js';
import { getPricingTier, SERVICE_FEE_RATE, FACILITY_FEE_RATE } from '../../services/pricing.service.js';

export const getSeatMap = async (eventId, sectionId) => {
  const section = await VenueSection.findOneActive({ _id: sectionId, event_id: eventId });
  if (!section) {
    return { error: 'section not found', status: 404 };
  }

  const event = await Event.findOneActive({ _id: eventId });
  if (!event) {
    return { error: 'event not found', status: 404 };
  }

  const available = getAvailableSeats(section);
  const sellThrough = getSellThroughRatio(section);
  const sellThroughPct = roundMoney(sellThrough * 100);
  const tier = getPricingTier(sellThrough);
  const currentPrice = roundMoney(section.base_price * tier.multiplier);

  return {
    data: {
      event_id: eventId,
      event_title: event.title,
      section_id: sectionId,
      section_name: section.name,
      capacity: section.capacity,
      sold: section.sold_count,
      held: section.held_count,
      available,
      sell_through_pct: sellThroughPct,
      pricing: {
        base_price: section.base_price,
        multiplier: tier.multiplier,
        tier: tier.label,
        current_price: currentPrice,
        service_fee: roundMoney(currentPrice * SERVICE_FEE_RATE),
        facility_fee: roundMoney(currentPrice * FACILITY_FEE_RATE),
      },
      status: available > 0 ? 'available' : 'sold_out',
    },
  };
};
