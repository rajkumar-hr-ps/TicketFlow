import { use, expect } from 'chai';
import chaiHttp from 'chai-http';
import { request } from 'chai-http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { app } from '../../src/app.js';
import { connectDB } from '../../src/config/db.js';
import { redisClient } from '../../src/config/redis.js';
import { config } from '../../src/config/env.js';
import { User } from '../../src/models/User.js';
import { Venue } from '../../src/models/Venue.js';
import { Event } from '../../src/models/Event.js';
import { VenueSection } from '../../src/models/VenueSection.js';
import { Order } from '../../src/models/Order.js';
import { Ticket } from '../../src/models/Ticket.js';
import { Payment } from '../../src/models/Payment.js';
import { PromoCode } from '../../src/models/PromoCode.js';

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (
  models = [Payment, Ticket, Order, PromoCode, VenueSection, Event, Venue, User]
) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Bug 6 — Venue Scheduling with Date Range Overlap Detection', function () {
  this.timeout(15000);

  let organizer, token, venue, venue2;

  // Fixed future base date for all tests
  const baseDate = new Date('2027-06-01T10:00:00Z');

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MONGO_URI = 'mongodb://localhost:27017/ticketflow_test';

    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI);
    }

    const dbName =
      mongoose.connection.db?.databaseName || mongoose.connection.name;
    if (dbName && !dbName.includes('test')) {
      throw new Error(
        `Not connected to test database! Connected to: ${dbName}`
      );
    }

    try {
      await redisClient.connect();
    } catch {
      // already connected
    }

    await cleanupModels();

    // --- Shared fixtures ---
    organizer = new User({
      name: 'Event Organizer',
      email: 'organizer@test.com',
      password: 'password123',
      role: 'customer',
    });
    await organizer.save();
    token = generateToken(organizer._id);

    venue = new Venue({
      name: 'Main Arena',
      address: '123 Test St',
      city: 'Test City',
      total_capacity: 5000,
    });
    await venue.save();

    venue2 = new Venue({
      name: 'Secondary Hall',
      address: '456 Other Ave',
      city: 'Test City',
      total_capacity: 3000,
    });
    await venue2.save();
  });

  beforeEach(async () => {
    await cleanupModels([Payment, Ticket, Order, PromoCode, VenueSection, Event]);
  });

  after(async () => {
    await cleanupModels();
    try {
      await redisClient.flushdb();
      await redisClient.quit();
    } catch {
      // ignore
    }
    await mongoose.connection.close();
  });

  // --- Test 01: Validation — end_date before start_date ---
  it('should return 400 when end_date is before start_date', async () => {
    const res = await request
      .execute(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Invalid Date Event',
        venue_id: venue._id.toString(),
        start_date: new Date('2027-06-05T10:00:00Z').toISOString(),
        end_date: new Date('2027-06-03T10:00:00Z').toISOString(),
        category: 'concert',
      });

    expect(res).to.have.status(400);
  });

  // --- Test 02: Conflict — new event falls in middle of multi-day festival ---
  it('should detect conflict when new event falls in middle of multi-day festival', async () => {
    // Existing 3-day festival: June 1 - June 3
    const existingEvent = new Event({
      title: 'Summer Festival',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date('2027-06-01T10:00:00Z'),
      end_date: new Date('2027-06-03T22:00:00Z'),
      status: 'on_sale',
      category: 'festival',
    });
    await existingEvent.save();

    // Try to create event on June 2 (falls in the middle)
    const res = await request
      .execute(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Mid-Festival Concert',
        venue_id: venue._id.toString(),
        start_date: new Date('2027-06-02T12:00:00Z').toISOString(),
        end_date: new Date('2027-06-02T20:00:00Z').toISOString(),
        category: 'concert',
      });

    expect(res).to.have.status(409);
    expect(res.body.error).to.include('venue not available');

    // DB verification: event was NOT created
    const dbEvent = await Event.findOne({ title: 'Mid-Festival Concert' });
    expect(dbEvent).to.be.null;
  });

  // --- Test 03: Conflict — partial overlap at start ---
  it('should detect partial overlap at start', async () => {
    // Existing event: June 2 - June 4
    const existingEvent = new Event({
      title: 'Existing Conference',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date('2027-06-02T10:00:00Z'),
      end_date: new Date('2027-06-04T18:00:00Z'),
      status: 'published',
      category: 'conference',
    });
    await existingEvent.save();

    // Try: June 1 - June 3 (overlaps June 2-3)
    const res = await request
      .execute(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Overlapping Start Event',
        venue_id: venue._id.toString(),
        start_date: new Date('2027-06-01T10:00:00Z').toISOString(),
        end_date: new Date('2027-06-03T18:00:00Z').toISOString(),
        category: 'concert',
      });

    expect(res).to.have.status(409);
    expect(res.body.error).to.include('venue not available');

    // DB verification: event was NOT created
    const dbEvent = await Event.findOne({ title: 'Overlapping Start Event' });
    expect(dbEvent).to.be.null;
  });

  // --- Test 04: Conflict — partial overlap at end ---
  it('should detect partial overlap at end', async () => {
    // Existing event: June 1 - June 3
    const existingEvent = new Event({
      title: 'Existing Sports Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date('2027-06-01T10:00:00Z'),
      end_date: new Date('2027-06-03T18:00:00Z'),
      status: 'on_sale',
      category: 'sports',
    });
    await existingEvent.save();

    // Try: June 2 - June 5 (overlaps June 2-3)
    const res = await request
      .execute(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Overlapping End Event',
        venue_id: venue._id.toString(),
        start_date: new Date('2027-06-02T10:00:00Z').toISOString(),
        end_date: new Date('2027-06-05T18:00:00Z').toISOString(),
        category: 'concert',
      });

    expect(res).to.have.status(409);
    expect(res.body.error).to.include('venue not available');

    // DB verification: event was NOT created
    const dbEvent = await Event.findOne({ title: 'Overlapping End Event' });
    expect(dbEvent).to.be.null;
  });

  // --- Test 05: Conflict — enclosed event (fully within existing) ---
  it('should detect enclosed event (fully within existing)', async () => {
    // Existing event: June 1 - June 5
    const existingEvent = new Event({
      title: 'Long Festival',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date('2027-06-01T10:00:00Z'),
      end_date: new Date('2027-06-05T22:00:00Z'),
      status: 'on_sale',
      category: 'festival',
    });
    await existingEvent.save();

    // Try: June 2 - June 3 (fully inside)
    const res = await request
      .execute(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Enclosed Concert',
        venue_id: venue._id.toString(),
        start_date: new Date('2027-06-02T10:00:00Z').toISOString(),
        end_date: new Date('2027-06-03T18:00:00Z').toISOString(),
        category: 'concert',
      });

    expect(res).to.have.status(409);
    expect(res.body.error).to.include('venue not available');

    // DB verification: event was NOT created
    const dbEvent = await Event.findOne({ title: 'Enclosed Concert' });
    expect(dbEvent).to.be.null;
  });

  // --- Test 06: Conflict — events too close (within 4-hour buffer) ---
  it('should detect conflict when events are too close (within 4-hour buffer)', async () => {
    // Existing event: June 1 10:00 - 18:00
    const existingEvent = new Event({
      title: 'Morning Show',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date('2027-06-01T10:00:00Z'),
      end_date: new Date('2027-06-01T18:00:00Z'),
      status: 'on_sale',
      category: 'concert',
    });
    await existingEvent.save();

    // Try: June 1 20:00 - 23:00 (only 2h gap after existing ends, < 4h buffer)
    // Existing ends at 18:00, buffered end = 22:00
    // New starts at 20:00, buffered start = 16:00
    // Overlap check: existingStart(10:00) < bufferedEnd(03:00+1) AND existingEnd(18:00) > bufferedStart(16:00) → conflict
    const res = await request
      .execute(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Evening Show',
        venue_id: venue._id.toString(),
        start_date: new Date('2027-06-01T20:00:00Z').toISOString(),
        end_date: new Date('2027-06-01T23:00:00Z').toISOString(),
        category: 'concert',
      });

    expect(res).to.have.status(409);
    expect(res.body.error).to.include('venue not available');

    // DB verification: event was NOT created
    const dbEvent = await Event.findOne({ title: 'Evening Show' });
    expect(dbEvent).to.be.null;
  });

  // --- Test 07: No conflict — cancelled events are ignored ---
  it('should ignore cancelled events (no conflict)', async () => {
    // Existing event with status='cancelled' — should be excluded from conflict check
    const cancelledEvent = new Event({
      title: 'Cancelled Festival',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date('2027-06-01T10:00:00Z'),
      end_date: new Date('2027-06-03T22:00:00Z'),
      status: 'cancelled',
      category: 'festival',
    });
    await cancelledEvent.save();

    // Create new event at the same venue and overlapping dates — should succeed
    const res = await request
      .execute(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Replacement Concert',
        venue_id: venue._id.toString(),
        start_date: new Date('2027-06-01T10:00:00Z').toISOString(),
        end_date: new Date('2027-06-03T22:00:00Z').toISOString(),
        category: 'concert',
      });

    expect(res).to.have.status(201);
    expect(res.body).to.have.property('event');
    expect(res.body.event).to.have.property('title', 'Replacement Concert');

    // DB verification: event was created with correct venue_id
    const dbEvent = await Event.findOne({ title: 'Replacement Concert' });
    expect(dbEvent).to.not.be.null;
    expect(dbEvent.venue_id.toString()).to.equal(venue._id.toString());
  });

  // --- Test 08: No conflict — non-overlapping dates ---
  it('should allow non-overlapping dates', async () => {
    // Existing event: June 1 - June 3
    const existingEvent = new Event({
      title: 'Early June Show',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date('2027-06-01T10:00:00Z'),
      end_date: new Date('2027-06-03T18:00:00Z'),
      status: 'on_sale',
      category: 'concert',
    });
    await existingEvent.save();

    // New event: June 10 - June 12 (well separated, no buffer conflict)
    const res = await request
      .execute(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Late June Show',
        venue_id: venue._id.toString(),
        start_date: new Date('2027-06-10T10:00:00Z').toISOString(),
        end_date: new Date('2027-06-12T18:00:00Z').toISOString(),
        category: 'concert',
      });

    expect(res).to.have.status(201);
    expect(res.body).to.have.property('event');
    expect(res.body.event).to.have.property('title', 'Late June Show');

    // DB verification: event was created with correct venue_id
    const dbEvent = await Event.findOne({ title: 'Late June Show' });
    expect(dbEvent).to.not.be.null;
    expect(dbEvent.venue_id.toString()).to.equal(venue._id.toString());
  });

  // --- Test 09: No conflict — different venues on same dates ---
  it('should allow events at different venues on same dates', async () => {
    // Existing event at venue1: June 1 - June 3
    const existingEvent = new Event({
      title: 'Arena Concert',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date('2027-06-01T10:00:00Z'),
      end_date: new Date('2027-06-03T18:00:00Z'),
      status: 'on_sale',
      category: 'concert',
    });
    await existingEvent.save();

    // New event at venue2 with same dates — should succeed (different venue)
    const res = await request
      .execute(app)
      .post('/api/v1/events')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Hall Conference',
        venue_id: venue2._id.toString(),
        start_date: new Date('2027-06-01T10:00:00Z').toISOString(),
        end_date: new Date('2027-06-03T18:00:00Z').toISOString(),
        category: 'conference',
      });

    expect(res).to.have.status(201);
    expect(res.body).to.have.property('event');
    expect(res.body.event).to.have.property('title', 'Hall Conference');

    // DB verification: event was created at venue2
    const dbEvent = await Event.findOne({ title: 'Hall Conference' });
    expect(dbEvent).to.not.be.null;
    expect(dbEvent.venue_id.toString()).to.equal(venue2._id.toString());
  });
});
