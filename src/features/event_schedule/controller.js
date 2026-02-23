import { getSchedule } from './service.js';

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

  const result = await getSchedule(startDate, endDate);

  return res.json(result);
};
