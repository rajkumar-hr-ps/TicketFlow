import { getSeatMap } from './service.js';

export const getSeatAvailabilityMap = async (req, res) => {
  const { id: eventId, sectionId } = req.params;

  const result = await getSeatMap(eventId, sectionId);

  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result.data);
};
