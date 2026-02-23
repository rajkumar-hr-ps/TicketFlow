import { joinWaitlist as joinWaitlistService, getWaitlistPosition as getWaitlistPositionService } from './service.js';

export const joinWaitlist = async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user._id;

  const result = await joinWaitlistService(eventId, userId);

  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.status(result.statusCode || 200).json(result.data);
};

export const getWaitlistPosition = async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user._id;

  const result = await getWaitlistPositionService(eventId, userId);

  if (result.error) {
    return res.status(result.status).json({ error: result.error });
  }

  return res.json(result.data);
};
