import * as sectionService from '../services/section.service.js';

export const getSections = async (req, res) => {
  const sections = await sectionService.getSectionsByEvent(req.params.id);
  res.json({ sections });
};

export const getSectionAvailability = async (req, res) => {
  const availability = await sectionService.getSectionAvailability(
    req.params.eventId,
    req.params.sectionId
  );
  res.json(availability);
};
