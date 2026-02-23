import { VenueSection } from '../../models/VenueSection.js';
import { Event } from '../../models/Event.js';
import { roundMoney, getAvailableSeats } from '../../utils/helpers.js';
import { getPricingTier, SERVICE_FEE_RATE, FACILITY_FEE_RATE, PROCESSING_FEE } from '../../services/pricing.service.js';

export const getDynamicPricing = async (req, res) => {
  const { id: eventId } = req.params;
  const { section_id, quantity } = req.query;

  if (!section_id) {
    return res.status(400).json({ error: 'section_id is required' });
  }

  const qty = parseInt(quantity, 10) || 1;
  if (qty < 1) {
    return res.status(400).json({ error: 'quantity must be at least 1' });
  }

  const event = await Event.findOneActive({ _id: eventId });
  if (!event) {
    return res.status(404).json({ error: 'event not found' });
  }

  const section = await VenueSection.findOneActive({ _id: section_id, event_id: eventId });
  if (!section) {
    return res.status(404).json({ error: 'section not found' });
  }

  const available = getAvailableSeats(section);
  if (qty > available) {
    return res.status(400).json({ error: 'requested quantity exceeds available seats' });
  }

  const sellThrough = section.capacity > 0 ? section.sold_count / section.capacity : 0;
  const tier = getPricingTier(sellThrough);

  // Urgency multiplier based on time until event
  const hoursUntilEvent = (new Date(event.start_date) - new Date()) / (1000 * 60 * 60);
  let urgencyMultiplier = 1.0;
  if (hoursUntilEvent <= 24) {
    urgencyMultiplier = 1.5;
  } else if (hoursUntilEvent <= 48) {
    urgencyMultiplier = 1.4;
  } else if (hoursUntilEvent <= 7 * 24) {
    urgencyMultiplier = 1.3;
  } else if (hoursUntilEvent <= 14 * 24) {
    urgencyMultiplier = 1.2;
  } else if (hoursUntilEvent <= 30 * 24) {
    urgencyMultiplier = 1.1;
  }

  // Quantity discount
  let quantityDiscountPct = 0;
  if (qty >= 10) {
    quantityDiscountPct = 10;
  } else if (qty >= 5) {
    quantityDiscountPct = 5;
  }

  const unitPrice = roundMoney(section.base_price * tier.multiplier * urgencyMultiplier);
  const serviceFeePerTicket = roundMoney(unitPrice * SERVICE_FEE_RATE);
  const facilityFeePerTicket = roundMoney(unitPrice * FACILITY_FEE_RATE);

  const subtotal = roundMoney(unitPrice * qty);
  const serviceFeeTotal = roundMoney(serviceFeePerTicket * qty);
  const facilityFeeTotal = roundMoney(facilityFeePerTicket * qty);
  const discountAmount = roundMoney(subtotal * (quantityDiscountPct / 100));
  const totalAmount = roundMoney(subtotal + serviceFeeTotal + facilityFeeTotal + PROCESSING_FEE - discountAmount);

  return res.json({
    event_id: eventId,
    event_title: event.title,
    section_id: section._id,
    section_name: section.name,
    quantity: qty,
    pricing: {
      base_price: section.base_price,
      multiplier: tier.multiplier,
      tier: tier.label,
      urgency_multiplier: urgencyMultiplier,
      quantity_discount_pct: quantityDiscountPct,
      unit_price: unitPrice,
      service_fee_per_ticket: serviceFeePerTicket,
      facility_fee_per_ticket: facilityFeePerTicket,
    },
    totals: {
      subtotal,
      service_fee_total: serviceFeeTotal,
      facility_fee_total: facilityFeeTotal,
      processing_fee: PROCESSING_FEE,
      discount_amount: discountAmount,
      total_amount: totalAmount,
    },
    availability: {
      capacity: section.capacity,
      sold: section.sold_count,
      held: section.held_count,
      available,
      sell_through_pct: roundMoney(sellThrough * 100),
    },
  });
};
