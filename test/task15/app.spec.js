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
import { VenueSection } from '../../src/models/VenueSection.js';
import {
  randomInt, randomPrice, roundMoney,
  getDemandMultiplier, computeTicketPrice, computeOrderTotal,
  computeDynamicUnitPrice, soldCountForTier,
  SERVICE_FEE_RATE, FACILITY_FEE_RATE, PROCESSING_FEE,
} from '../helpers/pricing.js';

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (models = [VenueSection, Event, Venue, User]) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Feature 5 — Dynamic Pricing Engine with Multi-Factor Calculation', function () {
  this.timeout(15000);

  let user, token, venue, event;
  let event20d, event10d, event36h, event12h;

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

    // Urgency events at different time horizons
    event20d = await Event.create({
      title: 'Urgency 20d Concert',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    event10d = await Event.create({
      title: 'Urgency 10d Concert',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    event36h = await Event.create({
      title: 'Urgency 36h Concert',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 36 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 36 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    event12h = await Event.create({
      title: 'Urgency 12h Concert',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 12 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 12 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
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
    const section = await VenueSection.create({
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
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'standard');

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.tier).to.equal('standard');
    expect(res.body.pricing.multiplier).to.equal(1);
    expect(res.body.pricing.unit_price).to.equal(basePrice);
  });

  // --- Test 06: should return peak tier for 90%+ sell-through ---
  it('should return peak tier for 90%+ sell-through', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'peak');
    const expectedUnitPrice = roundMoney(basePrice * 2.0);

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
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.tier).to.equal('peak');
    expect(res.body.pricing.multiplier).to.equal(2);
    expect(res.body.pricing.unit_price).to.equal(expectedUnitPrice);

    // Verify subtotal/line_total: for quantity=1, subtotal equals unit_price
    const expectedLineTotal = roundMoney(expectedUnitPrice * 1);
    expect(res.body.totals.subtotal).to.equal(expectedLineTotal);
    expect(res.body.totals.subtotal).to.equal(roundMoney(expectedLineTotal - (res.body.totals.discount_amount || 0)));
  });

  // --- Test 07: should return high_demand tier for 50-74% sell-through ---
  it('should return high_demand tier for 50-74% sell-through', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'high_demand');
    const expectedUnitPrice = roundMoney(basePrice * 1.25);

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Mezzanine',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.tier).to.equal('high_demand');
    expect(res.body.pricing.multiplier).to.equal(1.25);
    expect(res.body.pricing.unit_price).to.equal(expectedUnitPrice);
  });

  // --- Test 08: should calculate fees correctly per ticket ---
  it('should calculate fees correctly per ticket', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'very_high_demand');
    const unitPrice = roundMoney(basePrice * 1.5);
    const expectedServiceFee = roundMoney(unitPrice * SERVICE_FEE_RATE);
    const expectedFacilityFee = roundMoney(unitPrice * FACILITY_FEE_RATE);

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.unit_price).to.equal(unitPrice);
    expect(res.body.pricing.service_fee_per_ticket).to.equal(expectedServiceFee);
    expect(res.body.pricing.facility_fee_per_ticket).to.equal(expectedFacilityFee);
  });

  // --- Test 09: should calculate order totals correctly for multiple tickets ---
  it('should calculate order totals correctly for multiple tickets', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'very_high_demand');
    const quantity = randomInt(2, 4);
    const unitPrice = roundMoney(basePrice * 1.5);
    const serviceFee = roundMoney(unitPrice * SERVICE_FEE_RATE);
    const facilityFee = roundMoney(unitPrice * FACILITY_FEE_RATE);
    const expected = computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity });

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=${quantity}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.totals.subtotal).to.equal(expected.subtotal);
    expect(res.body.totals.service_fee_total).to.equal(expected.serviceFeeTotal);
    expect(res.body.totals.facility_fee_total).to.equal(expected.facilityFeeTotal);
    expect(res.body.totals.processing_fee).to.equal(PROCESSING_FEE);
    expect(res.body.totals.total_amount).to.equal(expected.totalAmount);
  });

  // --- Test 10: should include availability info in response ---
  it('should include availability info in response', async () => {
    const section = await VenueSection.create({
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
    const section = await VenueSection.create({
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

    // Verify breakdown/pricing object has expected structure
    expect(res.body.pricing).to.be.an('object');
    expect(res.body.pricing).to.have.property('service_fee_per_ticket');
    expect(res.body.pricing).to.have.property('facility_fee_per_ticket');
    expect(res.body.pricing).to.have.property('base_price');
    expect(res.body.pricing).to.have.property('multiplier');
    expect(res.body.pricing).to.have.property('tier');
    expect(res.body.pricing).to.have.property('unit_price');

    // Verify totals structure
    expect(res.body.totals).to.be.an('object');
    expect(res.body.totals).to.have.property('subtotal');
    expect(res.body.totals).to.have.property('service_fee_total');
    expect(res.body.totals).to.have.property('facility_fee_total');
    expect(res.body.totals).to.have.property('processing_fee');
    expect(res.body.totals).to.have.property('total_amount');
  });

  // --- Test 12: should apply 1.1x urgency multiplier for event 15-30 days away ---
  it('should apply 1.1x urgency multiplier for event 15-30 days away', async () => {
    const basePrice = randomPrice(50, 200);
    const expectedUnitPrice = computeDynamicUnitPrice(basePrice, 1.0, 1.1);

    const section = await VenueSection.create({
      event_id: event20d._id,
      venue_id: venue._id,
      name: 'Urgency General 20d',
      capacity: 100,
      base_price: basePrice,
      sold_count: 0,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event20d._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.urgency_multiplier).to.equal(1.1);
    expect(res.body.pricing.unit_price).to.equal(expectedUnitPrice);
  });

  // --- Test 13: should apply 1.2x urgency multiplier for event 7-14 days away ---
  it('should apply 1.2x urgency multiplier for event 7-14 days away', async () => {
    const basePrice = randomPrice(50, 200);
    const expectedUnitPrice = computeDynamicUnitPrice(basePrice, 1.0, 1.2);

    const section = await VenueSection.create({
      event_id: event10d._id,
      venue_id: venue._id,
      name: 'Urgency General 10d',
      capacity: 100,
      base_price: basePrice,
      sold_count: 0,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event10d._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.urgency_multiplier).to.equal(1.2);
    expect(res.body.pricing.unit_price).to.equal(expectedUnitPrice);
  });

  // --- Test 14: should apply 1.4x urgency multiplier for event 1-2 days away ---
  it('should apply 1.4x urgency multiplier for event 1-2 days away', async () => {
    const basePrice = randomPrice(50, 200);
    const expectedUnitPrice = computeDynamicUnitPrice(basePrice, 1.0, 1.4);

    const section = await VenueSection.create({
      event_id: event36h._id,
      venue_id: venue._id,
      name: 'Urgency General 36h',
      capacity: 100,
      base_price: basePrice,
      sold_count: 0,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event36h._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.urgency_multiplier).to.equal(1.4);
    expect(res.body.pricing.unit_price).to.equal(expectedUnitPrice);
  });

  // --- Test 15: should apply 1.5x urgency multiplier for event less than 24h away ---
  it('should apply 1.5x urgency multiplier for event less than 24h away', async () => {
    const basePrice = randomPrice(50, 200);
    const expectedUnitPrice = computeDynamicUnitPrice(basePrice, 1.0, 1.5);

    const section = await VenueSection.create({
      event_id: event12h._id,
      venue_id: venue._id,
      name: 'Urgency General 12h',
      capacity: 100,
      base_price: basePrice,
      sold_count: 0,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event12h._id}/pricing?section_id=${section._id}&quantity=1`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.urgency_multiplier).to.equal(1.5);
    expect(res.body.pricing.unit_price).to.equal(expectedUnitPrice);
  });

  // --- Test 16: should apply 5% quantity discount for 5 tickets ---
  it('should apply 5% quantity discount for 5 tickets', async () => {
    const basePrice = randomPrice(50, 200);
    const quantity = randomInt(5, 9); // 5-9 tickets → 5% discount
    // event is 45d out → urgency=1.0, 0% sold → demand=1.0
    const unitPrice = basePrice;
    const serviceFee = roundMoney(unitPrice * SERVICE_FEE_RATE);
    const facilityFee = roundMoney(unitPrice * FACILITY_FEE_RATE);
    const subtotal = roundMoney(unitPrice * quantity);
    const discountAmount = roundMoney(subtotal * 0.05);
    const expected = computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity, discountAmount });

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Discount Section 5',
      capacity: 100,
      base_price: basePrice,
      sold_count: 0,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=${quantity}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.quantity_discount_pct).to.equal(5);
    expect(res.body.totals.discount_amount).to.equal(discountAmount);
    expect(res.body.totals.total_amount).to.equal(expected.totalAmount);
  });

  // --- Test 17: should apply 10% quantity discount for 10+ tickets ---
  it('should apply 10% quantity discount for 10 tickets', async () => {
    const basePrice = randomPrice(50, 150);
    const quantity = randomInt(10, 15); // 10+ tickets → 10% discount
    const unitPrice = basePrice;
    const serviceFee = roundMoney(unitPrice * SERVICE_FEE_RATE);
    const facilityFee = roundMoney(unitPrice * FACILITY_FEE_RATE);
    const subtotal = roundMoney(unitPrice * quantity);
    const discountAmount = roundMoney(subtotal * 0.10);
    const expected = computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity, discountAmount });

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Discount Section 10',
      capacity: 100,
      base_price: basePrice,
      sold_count: 0,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event._id}/pricing?section_id=${section._id}&quantity=${quantity}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.quantity_discount_pct).to.equal(10);
    expect(res.body.totals.discount_amount).to.equal(discountAmount);
    expect(res.body.totals.total_amount).to.equal(expected.totalAmount);
  });

  // --- Test 18: should combine demand, urgency, and quantity discount factors ---
  it('should combine demand, urgency, and quantity discount factors', async () => {
    // event10d = 10 days out → urgency=1.2x
    // very_high_demand → demand=1.5x
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'very_high_demand');
    const quantity = randomInt(5, 9); // 5% quantity discount

    const unitPrice = computeDynamicUnitPrice(basePrice, 1.5, 1.2);
    const serviceFee = roundMoney(unitPrice * SERVICE_FEE_RATE);
    const facilityFee = roundMoney(unitPrice * FACILITY_FEE_RATE);
    const subtotal = roundMoney(unitPrice * quantity);
    const discountAmount = roundMoney(subtotal * 0.05);
    const expected = computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity, discountAmount });

    const section = await VenueSection.create({
      event_id: event10d._id,
      venue_id: venue._id,
      name: 'Combined Factors Section',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${event10d._id}/pricing?section_id=${section._id}&quantity=${quantity}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.pricing.unit_price).to.equal(unitPrice);
    expect(res.body.pricing.quantity_discount_pct).to.equal(5);
    expect(res.body.totals.discount_amount).to.equal(discountAmount);
    expect(res.body.totals.total_amount).to.equal(expected.totalAmount);
  });
});
