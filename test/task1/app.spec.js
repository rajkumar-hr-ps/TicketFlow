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

describe('Bug 1 — Order Total Pricing Pipeline', function () {
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

    // --- Shared fixtures ---
    user = new User({
      name: 'Test Customer',
      email: 'customer@test.com',
      password: 'password123',
      role: 'customer',
    });
    await user.save();
    token = generateToken(user._id);

    venue = new Venue({
      name: 'Test Arena',
      address: '123 Test St',
      city: 'Test City',
      total_capacity: 1000,
    });
    await venue.save();

    event = new Event({
      title: 'Test Concert',
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
    await cleanupModels([Payment, Ticket, Order, PromoCode, VenueSection]);
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

  // --- Test 01: Validation — section not found ---
  it('should return 404 when section does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: fakeId.toString(),
        quantity: 1,
      });

    expect(res).to.have.status(404);
  });

  // --- Test 02: Validation — invalid quantity ---
  it('should return 400 when quantity is zero or missing', async () => {
    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 0,
      held_count: 0,
    });
    await section.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity: 0,
      });

    expect(res).to.have.status(400);
  });

  // --- Test 03: Pricing — base rate with no demand (standard tier 1.0x) ---
  it('should calculate correct total at standard pricing tier with all fees', async () => {
    // 10% sell-through → 1.0x multiplier (standard)
    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 10,
      held_count: 0,
    });
    await section.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity: 2,
      });

    expect(res).to.have.status(201);
    // unit_price = $100 * 1.0 = $100
    // subtotal = 2 * $100 = $200
    // service_fee_total = 2 * ($100 * 0.12) = $24
    // facility_fee_total = 2 * ($100 * 0.05) = $10
    // processing_fee = $3
    // total = $200 + $24 + $10 + $3 = $237
    expect(res.body.unit_price).to.equal(100);
    expect(res.body.subtotal).to.equal(200);
    expect(res.body.service_fee_total).to.equal(24);
    expect(res.body.facility_fee_total).to.equal(10);
    expect(res.body.processing_fee).to.equal(3);
    expect(res.body.total_amount).to.equal(237);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.total_amount).to.equal(237);
    expect(order.subtotal).to.equal(200);
    expect(order.service_fee_total).to.equal(24);
    expect(order.facility_fee_total).to.equal(10);
  });

  // --- Test 04: Pricing — high demand multiplier (1.5x at 80% sell-through) ---
  it('should apply 1.5x multiplier at very high demand tier', async () => {
    // 80% sell-through → 1.5x multiplier (very_high_demand)
    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 100,
      base_price: 100,
      sold_count: 80,
      held_count: 0,
    });
    await section.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity: 1,
      });

    expect(res).to.have.status(201);
    // unit_price = $100 * 1.5 = $150
    // service_fee = $150 * 0.12 = $18
    // facility_fee = $150 * 0.05 = $7.50
    // processing = $3
    // total = $150 + $18 + $7.50 + $3 = $178.50
    expect(res.body.unit_price).to.equal(150);
    expect(res.body.service_fee_total).to.equal(18);
    expect(res.body.facility_fee_total).to.equal(7.5);
    expect(res.body.total_amount).to.equal(178.5);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.total_amount).to.equal(178.5);
    expect(order.subtotal).to.equal(150);
    const tickets = await Ticket.find({ order_id: order._id });
    expect(tickets).to.have.lengthOf(1);
    expect(tickets[0].unit_price).to.equal(150);
  });

  // --- Test 05: Pricing — peak demand multiplier (2.0x at 95% sell-through) ---
  it('should apply 2.0x multiplier at peak demand tier', async () => {
    // 95% sell-through → 2.0x multiplier (peak)
    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Front Row',
      capacity: 100,
      base_price: 100,
      sold_count: 95,
      held_count: 0,
    });
    await section.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity: 1,
      });

    expect(res).to.have.status(201);
    // unit_price = $100 * 2.0 = $200
    // service_fee = $200 * 0.12 = $24
    // facility_fee = $200 * 0.05 = $10
    // processing = $3
    // total = $200 + $24 + $10 + $3 = $237
    expect(res.body.unit_price).to.equal(200);
    expect(res.body.service_fee_total).to.equal(24);
    expect(res.body.facility_fee_total).to.equal(10);
    expect(res.body.total_amount).to.equal(237);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.total_amount).to.equal(237);
    expect(order.subtotal).to.equal(200);
    const tickets = await Ticket.find({ order_id: order._id });
    expect(tickets).to.have.lengthOf(1);
    expect(tickets[0].unit_price).to.equal(200);
  });

  // --- Test 06: Pricing — percentage promo discount applied to subtotal ---
  it('should apply percentage promo code discount to subtotal before fees', async () => {
    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Balcony',
      capacity: 100,
      base_price: 100,
      sold_count: 10,
      held_count: 0,
    });
    await section.save();

    const promo = new PromoCode({
      code: 'SAVE20',
      event_id: event._id,
      discount_type: 'percentage',
      discount_value: 20,
      max_uses: 100,
      current_uses: 0,
      valid_from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      min_tickets: 1,
    });
    await promo.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity: 2,
        promo_code: 'SAVE20',
      });

    expect(res).to.have.status(201);
    // subtotal = 2 * $100 = $200
    // discount = $200 * 0.20 = $40
    // service_fee_total = $24, facility_fee_total = $10, processing = $3
    // total = $200 + $24 + $10 + $3 - $40 = $197
    expect(res.body.discount_amount).to.equal(40);
    expect(res.body.total_amount).to.equal(197);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.discount_amount).to.equal(40);
    const updatedPromo = await PromoCode.findById(promo._id);
    expect(updatedPromo.current_uses).to.equal(1);
  });

  // --- Test 07: Pricing — fixed promo discount capped at subtotal ---
  it('should cap fixed promo discount at subtotal amount', async () => {
    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Upper Deck',
      capacity: 100,
      base_price: 100,
      sold_count: 10,
      held_count: 0,
    });
    await section.save();

    const promo = new PromoCode({
      code: 'BIGDEAL',
      event_id: event._id,
      discount_type: 'fixed',
      discount_value: 500,
      max_uses: 100,
      current_uses: 0,
      valid_from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      min_tickets: 1,
    });
    await promo.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity: 2,
        promo_code: 'BIGDEAL',
      });

    expect(res).to.have.status(201);
    // subtotal = 2 * $100 = $200
    // fixed discount $500 capped at subtotal → $200
    // service_fee_total = $24, facility_fee_total = $10, processing = $3
    // total = $200 + $24 + $10 + $3 - $200 = $37
    expect(res.body.discount_amount).to.equal(200);
    expect(res.body.total_amount).to.equal(37);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.discount_amount).to.equal(200);
    const updatedPromo = await PromoCode.findById(promo._id);
    expect(updatedPromo.current_uses).to.equal(1);
  });

  // --- Test 08: Response — all fee components present in response ---
  it('should return all fee component fields in the order response', async () => {
    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 200,
      base_price: 50,
      sold_count: 0,
      held_count: 0,
    });
    await section.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity: 1,
      });

    expect(res).to.have.status(201);
    expect(res.body).to.have.property('unit_price');
    expect(res.body).to.have.property('multiplier');
    expect(res.body).to.have.property('subtotal');
    expect(res.body).to.have.property('service_fee_total');
    expect(res.body).to.have.property('facility_fee_total');
    expect(res.body).to.have.property('processing_fee');
    expect(res.body).to.have.property('discount_amount');
    expect(res.body).to.have.property('total_amount');

    // Verify the order was also persisted correctly in DB
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.total_amount).to.equal(res.body.total_amount);
    expect(order.service_fee_total).to.equal(res.body.service_fee_total);
    expect(order.facility_fee_total).to.equal(res.body.facility_fee_total);
    expect(order.processing_fee).to.equal(res.body.processing_fee);
  });
});
