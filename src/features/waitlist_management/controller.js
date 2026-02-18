import mongoose from 'mongoose';
import { Event, EventStatus } from '../../models/Event.js';
import { WaitlistEntry, WaitlistStatus } from '../../models/WaitlistEntry.js';

export const joinWaitlist = async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user._id;

  const event = await Event.findOneActive({ _id: eventId });
  if (!event) {
    return res.status(404).json({ error: 'event not found' });
  }

  if (event.status !== EventStatus.SOLD_OUT) {
    return res.status(400).json({ error: 'waitlist is only available for sold-out events' });
  }

  // Check for existing entry
  const existing = await WaitlistEntry.findOne({
    event_id: eventId,
    user_id: userId,
    status: WaitlistStatus.WAITING,
  });
  if (existing) {
    return res.status(409).json({ error: 'already on waitlist for this event' });
  }

  // Atomic position assignment
  const counter = await mongoose.connection.db.collection('waitlist_counters')
    .findOneAndUpdate(
      { event_id: new mongoose.Types.ObjectId(eventId) },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );

  const entry = await WaitlistEntry.create({
    event_id: eventId,
    user_id: userId,
    position: counter.seq,
    status: WaitlistStatus.WAITING,
  });

  const totalAhead = await WaitlistEntry.countDocuments({
    event_id: eventId,
    position: { $lt: entry.position },
    status: WaitlistStatus.WAITING,
  });

  return res.status(201).json({
    waitlist_id: entry._id,
    event_id: eventId,
    position: entry.position,
    ahead: totalAhead,
    status: WaitlistStatus.WAITING,
    joined_at: entry.created_at,
  });
};

export const getWaitlistPosition = async (req, res) => {
  const eventId = req.params.id;
  const userId = req.user._id;

  const entry = await WaitlistEntry.findOne({
    event_id: eventId,
    user_id: userId,
    status: WaitlistStatus.WAITING,
  });
  if (!entry) {
    return res.status(404).json({ error: 'not on waitlist for this event' });
  }

  const totalAhead = await WaitlistEntry.countDocuments({
    event_id: eventId,
    position: { $lt: entry.position },
    status: WaitlistStatus.WAITING,
  });

  const totalWaiting = await WaitlistEntry.countDocuments({
    event_id: eventId,
    status: WaitlistStatus.WAITING,
  });

  return res.json({
    waitlist_id: entry._id,
    event_id: eventId,
    position: entry.position,
    ahead: totalAhead,
    total_waiting: totalWaiting,
    status: entry.status,
    joined_at: entry.created_at,
  });
};
