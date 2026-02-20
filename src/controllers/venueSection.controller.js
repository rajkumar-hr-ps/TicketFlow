import * as venueSectionService from '../services/venueSection.service.js';

export const getVenueSections = async (req, res) => {
  const sections = await venueSectionService.getSectionsByEvent(req.params.id);
  res.json({ sections });
};

export const getVenueSectionAvailability = async (req, res) => {
  const availability = await venueSectionService.getSectionAvailability(
    req.params.eventId,
    req.params.sectionId
  );
  res.json(availability);
};
