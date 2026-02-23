import mongoose from 'mongoose';
import { Event, EventStatus } from '../../models/Event.js';
import { WaitlistEntry, WaitlistStatus } from '../../models/WaitlistEntry.js';

export const joinWaitlist = async (eventId, userId) => {
  const event = await Event.findOneActive({ _id: eventId });
  if (!event) {
    return { error: 'event not found', status: 404 };
  }

  if (event.status !== EventStatus.SOLD_OUT) {
    return { error: 'waitlist is only available for sold-out events', status: 400 };
  }

  // Check for existing entry
  const existing = await WaitlistEntry.findOne({
    event_id: eventId,
    user_id: userId,
    status: WaitlistStatus.WAITING,
  });
  if (existing) {
    return { error: 'already on waitlist for this event', status: 409 };
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

  return {
    data: {
      waitlist_id: entry._id,
      event_id: eventId,
      position: entry.position,
      ahead: totalAhead,
      status: WaitlistStatus.WAITING,
      joined_at: entry.created_at,
    },
    statusCode: 201,
  };
};

export const getWaitlistPosition = async (eventId, userId) => {
  const entry = await WaitlistEntry.findOne({
    event_id: eventId,
    user_id: userId,
    status: WaitlistStatus.WAITING,
  });
  if (!entry) {
    return { error: 'not on waitlist for this event', status: 404 };
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

  return {
    data: {
      waitlist_id: entry._id,
      event_id: eventId,
      position: entry.position,
      ahead: totalAhead,
      total_waiting: totalWaiting,
      status: entry.status,
      joined_at: entry.created_at,
    },
  };
};
