import { use, expect } from 'chai';
import chaiHttp from 'chai-http';
import { request } from 'chai-http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { app } from '../../src/app.js';
import { redisClient } from '../../src/config/redis.js';
import { config } from '../../src/config/env.js';
import { User } from '../../src/models/User.js';
import { Venue } from '../../src/models/Venue.js';
import { Event } from '../../src/models/Event.js';
import { Section } from '../../src/models/Section.js';

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (models = [Section, Event, Venue, User]) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Feature 5 — Dynamic Pricing Engine with Multi-Factor Calculation', function () {
  this.timeout(15000);

  let user, token, venue, event;

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

    user = await User.create({ name: 'Pricing User', email: 'pricing@test.com', password: 'password123', role: 'customer' });
    token = generateToken(user._id);

    venue = await Venue.create({ name: 'Pricing Arena', address: '500 Price St', city: 'Test City', total_capacity: 5000 });

    event = await Event.create({
      title: 'Pricing Concert',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
  });

  beforeEach(async () => {
    await Section.deleteMany({});
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

  // --- Test 01: should return 400 when section_id is missing ---
  it('should return 400 when section_id is missing', async () => {
    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('section_id');
  });

  // --- Test 02: should return 404 when event does not exist ---
  it('should return 404 when event does not exist', async () => {
    const fakeEventId = new mongoose.Types.ObjectId();
    const fakeSectionId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${fakeEventId}/pricing?section_id=${fakeSectionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(404);
  });

  // --- Test 03: should return 404 when section does not exist ---
  it('should return 404 when section does not exist', async () => {
    const fakeSectionId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${fakeSectionId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(404);
  });

  // --- Test 04: should return 400 when quantity exceeds available seats ---
  it('should return 400 when quantity exceeds available seats', async () => {
    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 10,
      base_price: 200,
      sold_count: 8,
      held_count: 1,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=5`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('exceeds');
  });

  // --- Test 05: should return standard tier for low sell-through ---
  it('should return standard tier for low sell-through', async () => {
    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 100,
      base_price: 100,
      sold_count: 20,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.tier).to.equal('standard');
    expect(res.body.pricing.multiplier).to.equal(1);
    expect(res.body.pricing.unit_price).to.equal(100);
  });

  // --- Test 06: should return peak tier for 90%+ sell-through ---
  it('should return peak tier for 90%+ sell-through', async () => {
    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 100,
      base_price: 100,
      sold_count: 95,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.tier).to.equal('peak');
    expect(res.body.pricing.multiplier).to.equal(2);
    expect(res.body.pricing.unit_price).to.equal(200);
  });

  // --- Test 07: should return high_demand tier for 50-74% sell-through ---
  it('should return high_demand tier for 50-74% sell-through', async () => {
    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Mezzanine',
      capacity: 100,
      base_price: 80,
      sold_count: 60,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.tier).to.equal('high_demand');
    expect(res.body.pricing.multiplier).to.equal(1.25);
    expect(res.body.pricing.unit_price).to.equal(100); // 80 * 1.25
  });

  // --- Test 08: should calculate fees correctly per ticket ---
  it('should calculate fees correctly per ticket', async () => {
    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 80,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    // 80% sell-through = very_high_demand = 1.5x
    const unitPrice = 150; // 100 * 1.5
    expect(res.body.pricing.unit_price).to.equal(unitPrice);
    expect(res.body.pricing.service_fee_per_ticket).to.equal(18); // 150 * 0.12
    expect(res.body.pricing.facility_fee_per_ticket).to.equal(7.5); // 150 * 0.05
  });

  // --- Test 09: should calculate order totals correctly for multiple tickets ---
  it('should calculate order totals correctly for multiple tickets', async () => {
    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 80,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=4`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    // 80% sell-through = very_high_demand = 1.5x, unit=150
    expect(res.body.totals.subtotal).to.equal(600); // 150*4
    expect(res.body.totals.service_fee_total).to.equal(72); // 18*4
    expect(res.body.totals.facility_fee_total).to.equal(30); // 7.5*4
    expect(res.body.totals.processing_fee).to.equal(3);
    expect(res.body.totals.total_amount).to.equal(705); // 600+72+30+3
  });

  // --- Test 10: should include availability info in response ---
  it('should include availability info in response', async () => {
    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Balcony',
      capacity: 200,
      base_price: 50,
      sold_count: 80,
      held_count: 10,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=2`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.availability).to.exist;
    expect(res.body.availability.capacity).to.equal(200);
    expect(res.body.availability.sold).to.equal(80);
    expect(res.body.availability.held).to.equal(10);
    expect(res.body.availability.available).to.equal(110);
    expect(res.body.availability.sell_through_pct).to.equal(40); // 80/200*100
  });

  // --- Test 11: should default quantity to 1 when not provided ---
  it('should default quantity to 1 when not provided', async () => {
    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 100,
      base_price: 100,
      sold_count: 10,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.quantity).to.equal(1);
    expect(res.body.totals.subtotal).to.equal(res.body.pricing.unit_price);
  });
});
