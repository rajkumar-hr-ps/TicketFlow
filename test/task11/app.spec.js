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
import {
  randomInt, randomPrice, roundMoney,
  getDemandMultiplier, computeTicketPrice, soldCountForTier,
} from '../helpers/pricing.js';

use(chaiHttp);

const cleanupModels = async (models = [VenueSection, Event, Venue, User]) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Feature 1 — Seat Availability Map for Event Section', function () {
  this.timeout(15000);

  let venue, event;

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

    const user = new User({
      name: 'Seat Map User',
      email: 'seatmap@test.com',
      password: 'password123',
      role: 'customer',
    });
    await user.save();

    venue = new Venue({
      name: 'Seat Map Arena',
      address: '100 Map St',
      city: 'Test City',
      total_capacity: 5000,
    });
    await venue.save();

    event = new Event({
      title: 'Seat Map Concert',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
    await event.save();
  });

  beforeEach(async () => {
    await VenueSection.deleteMany({});
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

  // --- Test 01: should return 404 when section does not exist ---
  it('should return 404 when section does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${fakeId}/seat-map`);

    expect(res).to.have.status(404);
  });

  // --- Test 02: should return 404 when event does not exist ---
  it('should return 404 when event does not exist', async () => {
    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 100,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });

    const fakeEventId = new mongoose.Types.ObjectId();
    const res = await request
      .execute(app)
      .get(`/api/v1/events/${fakeEventId}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(404);
  });

  // --- Test 03: should return correct available seat count ---
  it('should return correct available seat count', async () => {
    const capacity = randomInt(80, 200);
    const soldCount = randomInt(10, Math.floor(capacity * 0.5));
    const heldCount = randomInt(1, Math.floor((capacity - soldCount) * 0.3));
    const expectedAvailable = capacity - soldCount - heldCount;

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity,
      base_price: randomPrice(50, 200),
      sold_count: soldCount,
      held_count: heldCount,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(200);
    expect(res.body.available).to.equal(expectedAvailable);
    expect(res.body.sold).to.equal(soldCount);
    expect(res.body.held).to.equal(heldCount);
    expect(res.body.capacity).to.equal(capacity);
  });

  // --- Test 04: should return sold_out status when no seats available ---
  it('should return sold_out status when no seats available', async () => {
    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 100,
      base_price: 200,
      sold_count: 100,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(200);
    expect(res.body.status).to.equal('sold_out');
    expect(res.body.available).to.equal(0);
  });

  // --- Test 04b: should return sold_out when available is zero due to held_count ---
  it('should return sold_out when available is zero due to held_count', async () => {
    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Held Out Section',
      capacity: 100,
      base_price: 200,
      sold_count: 90,
      held_count: 10,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(200);
    expect(res.body.available).to.equal(0);
    expect(res.body.status).to.equal('sold_out');
  });

  // --- Test 05: should return correct pricing tier and multiplier ---
  it('should return correct pricing tier and multiplier', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'very_high_demand');
    const { unitPrice } = computeTicketPrice(basePrice, 1.5);

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.tier).to.equal('very_high_demand');
    expect(res.body.pricing.multiplier).to.equal(1.5);
    expect(res.body.pricing.current_price).to.equal(unitPrice);
  });

  // --- Test 06: should calculate fees correctly ---
  it('should calculate fees correctly', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'very_high_demand');
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.5);

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.service_fee).to.equal(serviceFee);
    expect(res.body.pricing.facility_fee).to.equal(facilityFee);
  });

  // --- Test 07: should calculate sell_through_pct correctly ---
  it('should calculate sell_through_pct correctly', async () => {
    const capacity = randomInt(100, 500);
    const soldCount = randomInt(10, capacity - 10);
    const expectedPct = roundMoney((soldCount / capacity) * 100);

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Mezzanine',
      capacity,
      base_price: randomPrice(50, 200),
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(200);
    expect(res.body.sell_through_pct).to.equal(expectedPct);
  });

  // --- Test 08: should contain all required fields in response ---
  it('should contain all required fields in response', async () => {
    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Balcony',
      capacity: 200,
      base_price: 50,
      sold_count: 20,
      held_count: 5,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(200);
    expect(res.body).to.have.property('event_id');
    expect(res.body).to.have.property('event_title');
    expect(res.body).to.have.property('section_id');
    expect(res.body).to.have.property('section_name');
    expect(res.body).to.have.property('capacity');
    expect(res.body).to.have.property('sold');
    expect(res.body).to.have.property('held');
    expect(res.body).to.have.property('available');
    expect(res.body).to.have.property('sell_through_pct');
    expect(res.body).to.have.property('pricing');
    expect(res.body.pricing).to.have.property('base_price');
    expect(res.body.pricing).to.have.property('multiplier');
    expect(res.body.pricing).to.have.property('tier');
    expect(res.body.pricing).to.have.property('current_price');
    expect(res.body.pricing).to.have.property('service_fee');
    expect(res.body.pricing).to.have.property('facility_fee');
    expect(res.body).to.have.property('status');
    expect(res.body.status).to.equal('available');

    // Verify returned IDs match fixture IDs
    expect(res.body.event_id.toString()).to.equal(event._id.toString());
    expect(res.body.section_id.toString()).to.equal(section._id.toString());
  });

  // --- Test 09: should return standard tier at low sell-through ---
  it('should return standard tier at low sell-through', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'standard');
    const { unitPrice } = computeTicketPrice(basePrice, 1.0);

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Standard Section',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.tier).to.equal('standard');
    expect(res.body.pricing.multiplier).to.equal(1.0);
    expect(res.body.pricing.current_price).to.equal(unitPrice);
  });

  // --- Test 10: should return high_demand tier at 50-74% sell-through ---
  it('should return high_demand tier at 50-74% sell-through', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'high_demand');
    const { unitPrice } = computeTicketPrice(basePrice, 1.25);

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'High Demand Section',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.tier).to.equal('high_demand');
    expect(res.body.pricing.multiplier).to.equal(1.25);
    expect(res.body.pricing.current_price).to.equal(unitPrice);
  });

  // --- Test 11: should return peak tier at 90%+ sell-through ---
  it('should return peak tier at 90%+ sell-through', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'peak');
    const { unitPrice } = computeTicketPrice(basePrice, 2.0);

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Peak Section',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/venue-sections/${section._id}/seat-map`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.tier).to.equal('peak');
    expect(res.body.pricing.multiplier).to.equal(2.0);
    expect(res.body.pricing.current_price).to.equal(unitPrice);
  });
});
