import * as venueSectionService from '../services/venueSection.service.js';

export const getVenueSections = async (req, res) => {
  const venueSections = await venueSectionService.getSectionsByEvent(req.params.id);
  res.json({ venueSections });
};

export const getVenueSectionAvailability = async (req, res) => {
  const availability = await venueSectionService.getSectionAvailability(
    req.params.eventId,
    req.params.sectionId
  );
  res.json(availability);
};
