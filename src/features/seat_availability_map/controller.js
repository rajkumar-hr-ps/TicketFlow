import { Section } from '../../models/Section.js';
import { Event } from '../../models/Event.js';
import { getPricingTier, roundMoney } from '../../utils/helpers.js';

export const getSeatAvailabilityMap = async (req, res) => {
  const { id: eventId, sectionId } = req.params;

  const section = await Section.findOneActive({ _id: sectionId, event_id: eventId });
  if (!section) {
    return res.status(404).json({ error: 'section not found' });
  }

  const event = await Event.findOneActive({ _id: eventId });
  if (!event) {
    return res.status(404).json({ error: 'event not found' });
  }

  const available = Math.max(0, section.capacity - section.sold_count - section.held_count);
  const sellThroughPct = section.capacity > 0
    ? roundMoney((section.sold_count / section.capacity) * 100)
    : 0;

  const sellThrough = section.capacity > 0 ? section.sold_count / section.capacity : 0;
  const tier = getPricingTier(sellThrough);
  const currentPrice = roundMoney(section.base_price * tier.multiplier);

  return res.json({
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
      service_fee: roundMoney(currentPrice * 0.12),
      facility_fee: roundMoney(currentPrice * 0.05),
    },
    status: available > 0 ? 'available' : 'sold_out',
  });
};
