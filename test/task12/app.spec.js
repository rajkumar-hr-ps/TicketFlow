import { use, expect } from 'chai';
import chaiHttp from 'chai-http';
import { request } from 'chai-http';
import mongoose from 'mongoose';
import { app } from '../../src/app.js';
import { redisClient } from '../../src/config/redis.js';
import { User } from '../../src/models/User.js';
import { Venue } from '../../src/models/Venue.js';
import { Event } from '../../src/models/Event.js';
import { VenueSection } from '../../src/models/VenueSection.js';

use(chaiHttp);

const cleanupModels = async (models = [VenueSection, Event, Venue, User]) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Feature 2 — Event Schedule with Date Filter and Venue Grouping', function () {
  this.timeout(15000);

  let user, venue1, venue2;

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

    user = new User({
      name: 'Schedule User',
      email: 'schedule@test.com',
      password: 'password123',
      role: 'customer',
    });
    await user.save();

    venue1 = new Venue({
      name: 'Arena One',
      address: '100 Main St',
      city: 'New York',
      total_capacity: 5000,
    });
    await venue1.save();

    venue2 = new Venue({
      name: 'Arena Two',
      address: '200 Side St',
      city: 'Los Angeles',
      total_capacity: 3000,
    });
    await venue2.save();
  });

  beforeEach(async () => {
    await VenueSection.deleteMany({});
    await Event.deleteMany({});
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

  // --- Test 01: should return 400 when dates are missing ---
  it('should return 400 when dates are missing', async () => {
    const res = await request
      .execute(app)
      .get('/api/v1/events/schedule');

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('required');
  });

  // --- Test 02: should return 400 for invalid date format ---
  it('should return 400 for invalid date format', async () => {
    const res = await request
      .execute(app)
      .get('/api/v1/events/schedule?start_date=not-a-date&end_date=also-bad');

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('invalid');
  });

  // --- Test 03: should return 400 when end_date is before start_date ---
  it('should return 400 when end_date is before start_date', async () => {
    const res = await request
      .execute(app)
      .get('/api/v1/events/schedule?start_date=2025-06-30&end_date=2025-06-01');

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('after');
  });

  // --- Test 04: should group events by venue ---
  it('should group events by venue', async () => {
    const baseDate = new Date('2025-07-15T10:00:00Z');
    const endDate = new Date('2025-07-15T14:00:00Z');

    await Event.create({
      title: 'Concert at Arena One',
      venue_id: venue1._id,
      organizer_id: user._id,
      start_date: baseDate,
      end_date: endDate,
      status: 'on_sale',
      category: 'concert',
    });

    await Event.create({
      title: 'Show at Arena Two',
      venue_id: venue2._id,
      organizer_id: user._id,
      start_date: baseDate,
      end_date: endDate,
      status: 'on_sale',
      category: 'concert',
    });

    await Event.create({
      title: 'Another at Arena One',
      venue_id: venue1._id,
      organizer_id: user._id,
      start_date: new Date('2025-07-16T10:00:00Z'),
      end_date: new Date('2025-07-16T14:00:00Z'),
      status: 'on_sale',
      category: 'concert',
    });

    const res = await request
      .execute(app)
      .get('/api/v1/events/schedule?start_date=2025-07-01&end_date=2025-07-31');

    expect(res).to.have.status(200);
    expect(res.body.venues).to.be.an('array').with.lengthOf(2);
    expect(res.body.total_events).to.equal(3);

    const arenaOne = res.body.venues.find((v) => v.venue_name === 'Arena One');
    expect(arenaOne.events).to.have.lengthOf(2);

    // Verify events within a venue are ordered chronologically
    const events = arenaOne.events;
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].start_date)).to.be.above(new Date(events[i-1].start_date));
    }

    // Verify period_start and period_end are present in response
    expect(res.body).to.have.property('period_start');
    expect(res.body).to.have.property('period_end');
  });

  // --- Test 05: should only return events within date range ---
  it('should only return events within date range', async () => {
    await Event.create({
      title: 'In Range',
      venue_id: venue1._id,
      organizer_id: user._id,
      start_date: new Date('2025-08-15T10:00:00Z'),
      end_date: new Date('2025-08-15T14:00:00Z'),
      status: 'on_sale',
      category: 'concert',
    });

    await Event.create({
      title: 'Out of Range',
      venue_id: venue1._id,
      organizer_id: user._id,
      start_date: new Date('2025-09-15T10:00:00Z'),
      end_date: new Date('2025-09-15T14:00:00Z'),
      status: 'on_sale',
      category: 'concert',
    });

    const res = await request
      .execute(app)
      .get('/api/v1/events/schedule?start_date=2025-08-01&end_date=2025-08-31');

    expect(res).to.have.status(200);
    expect(res.body.total_events).to.equal(1);
    expect(res.body.venues[0].events[0].title).to.equal('In Range');
  });

  // --- Test 06: should calculate price_range from sections ---
  it('should calculate price_range from sections', async () => {
    const evt = await Event.create({
      title: 'Priced Event',
      venue_id: venue1._id,
      organizer_id: user._id,
      start_date: new Date('2025-10-15T10:00:00Z'),
      end_date: new Date('2025-10-15T14:00:00Z'),
      status: 'on_sale',
      category: 'concert',
    });

    await VenueSection.create([
      { event_id: evt._id, venue_id: venue1._id, name: 'Cheap', capacity: 100, base_price: 50, sold_count: 0, held_count: 0 },
      { event_id: evt._id, venue_id: venue1._id, name: 'Mid', capacity: 100, base_price: 100, sold_count: 0, held_count: 0 },
      { event_id: evt._id, venue_id: venue1._id, name: 'VIP', capacity: 50, base_price: 200, sold_count: 0, held_count: 0 },
    ]);

    const res = await request
      .execute(app)
      .get('/api/v1/events/schedule?start_date=2025-10-01&end_date=2025-10-31');

    expect(res).to.have.status(200);
    const eventData = res.body.venues[0].events[0];
    expect(eventData.price_range.min).to.equal(50);
    expect(eventData.price_range.max).to.equal(200);
  });

  // --- Test 07: should sum total_available across sections ---
  it('should sum total_available across sections', async () => {
    const evt = await Event.create({
      title: 'Available Event',
      venue_id: venue1._id,
      organizer_id: user._id,
      start_date: new Date('2025-11-15T10:00:00Z'),
      end_date: new Date('2025-11-15T14:00:00Z'),
      status: 'on_sale',
      category: 'concert',
    });

    await VenueSection.create([
      { event_id: evt._id, venue_id: venue1._id, name: 'A', capacity: 100, base_price: 50, sold_count: 30, held_count: 10 },
      { event_id: evt._id, venue_id: venue1._id, name: 'B', capacity: 200, base_price: 75, sold_count: 50, held_count: 0 },
    ]);

    const res = await request
      .execute(app)
      .get('/api/v1/events/schedule?start_date=2025-11-01&end_date=2025-11-30');

    expect(res).to.have.status(200);
    const eventData = res.body.venues[0].events[0];
    // A: 100-30-10=60, B: 200-50-0=150 => total 210
    expect(eventData.total_available).to.equal(210);
    expect(eventData.sections_count).to.equal(2);
  });

  // --- Test 08: should exclude draft events ---
  it('should exclude draft events', async () => {
    await Event.create({
      title: 'Draft Event',
      venue_id: venue1._id,
      organizer_id: user._id,
      start_date: new Date('2025-12-15T10:00:00Z'),
      end_date: new Date('2025-12-15T14:00:00Z'),
      status: 'draft',
      category: 'concert',
    });

    await Event.create({
      title: 'Active Event',
      venue_id: venue1._id,
      organizer_id: user._id,
      start_date: new Date('2025-12-16T10:00:00Z'),
      end_date: new Date('2025-12-16T14:00:00Z'),
      status: 'on_sale',
      category: 'concert',
    });

    const res = await request
      .execute(app)
      .get('/api/v1/events/schedule?start_date=2025-12-01&end_date=2025-12-31');

    expect(res).to.have.status(200);
    expect(res.body.total_events).to.equal(1);
    expect(res.body.venues[0].events[0].title).to.equal('Active Event');
  });

  // --- Test 09: should include sold_out events in schedule ---
  it('should include sold_out events in schedule', async () => {
    await Event.create({
      title: 'Sold Out Event',
      venue_id: venue1._id,
      organizer_id: user._id,
      start_date: new Date('2026-01-15T10:00:00Z'),
      end_date: new Date('2026-01-15T14:00:00Z'),
      status: 'sold_out',
      category: 'concert',
    });

    const res = await request
      .execute(app)
      .get('/api/v1/events/schedule?start_date=2026-01-01&end_date=2026-01-31');

    expect(res).to.have.status(200);
    expect(res.body.total_events).to.equal(1);
    expect(res.body.venues[0].events[0].title).to.equal('Sold Out Event');
  });
});
