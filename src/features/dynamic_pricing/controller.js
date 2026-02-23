import { getDynamicPricingForSection } from './service.js';

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

  const result = await getDynamicPricingForSection(eventId, section_id, qty);

  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result.data);
};
