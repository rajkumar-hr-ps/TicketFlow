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
import {
  randomInt, randomPrice, roundMoney,
  getDemandMultiplier, computeTicketPrice, computeOrderTotal,
  soldCountForTier, PROCESSING_FEE,
} from '../helpers/pricing.js';

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
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'standard');
    const quantity = randomInt(1, 4);

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });
    await section.save();

    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const expected = computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity });

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity,
      });

    expect(res).to.have.status(201);
    expect(res.body.unit_price).to.equal(unitPrice);
    expect(res.body.multiplier).to.equal(1.0);
    expect(res.body.subtotal).to.equal(expected.subtotal);
    expect(res.body.service_fee_total).to.equal(expected.serviceFeeTotal);
    expect(res.body.facility_fee_total).to.equal(expected.facilityFeeTotal);
    expect(res.body.processing_fee).to.equal(PROCESSING_FEE);
    expect(res.body.total_amount).to.equal(expected.totalAmount);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.total_amount).to.equal(expected.totalAmount);
    expect(order.subtotal).to.equal(expected.subtotal);
    expect(order.service_fee_total).to.equal(expected.serviceFeeTotal);
    expect(order.facility_fee_total).to.equal(expected.facilityFeeTotal);
  });

  // --- Test 03b: Pricing — high demand multiplier (1.25x at 50-74% sell-through) ---
  it('should apply 1.25x multiplier at high demand tier', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'high_demand');
    const quantity = randomInt(1, 4);

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Mezzanine',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });
    await section.save();

    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.25);
    const expected = computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity });

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity,
      });

    expect(res).to.have.status(201);
    expect(res.body.unit_price).to.equal(unitPrice);
    expect(res.body.multiplier).to.equal(1.25);
    expect(res.body.subtotal).to.equal(expected.subtotal);
    expect(res.body.service_fee_total).to.equal(expected.serviceFeeTotal);
    expect(res.body.facility_fee_total).to.equal(expected.facilityFeeTotal);
    expect(res.body.processing_fee).to.equal(PROCESSING_FEE);
    expect(res.body.total_amount).to.equal(expected.totalAmount);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.total_amount).to.equal(expected.totalAmount);
    expect(order.subtotal).to.equal(expected.subtotal);
    expect(order.service_fee_total).to.equal(expected.serviceFeeTotal);
    expect(order.facility_fee_total).to.equal(expected.facilityFeeTotal);
  });

  // --- Test 04: Pricing — high demand multiplier (1.5x at 75-89% sell-through) ---
  it('should apply 1.5x multiplier at very high demand tier', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'very_high_demand');
    const quantity = randomInt(1, 3);

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });
    await section.save();

    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.5);
    const expected = computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity });

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity,
      });

    expect(res).to.have.status(201);
    expect(res.body.unit_price).to.equal(unitPrice);
    expect(res.body.multiplier).to.equal(1.5);
    expect(res.body.service_fee_total).to.equal(expected.serviceFeeTotal);
    expect(res.body.facility_fee_total).to.equal(expected.facilityFeeTotal);
    expect(res.body.total_amount).to.equal(expected.totalAmount);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.total_amount).to.equal(expected.totalAmount);
    expect(order.subtotal).to.equal(expected.subtotal);
    const tickets = await Ticket.find({ order_id: order._id });
    expect(tickets).to.have.lengthOf(quantity);
    expect(tickets[0].unit_price).to.equal(unitPrice);
  });

  // --- Test 05: Pricing — peak demand multiplier (2.0x at 90%+ sell-through) ---
  it('should apply 2.0x multiplier at peak demand tier', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'peak');

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Front Row',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });
    await section.save();

    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 2.0);
    const expected = computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity: 1 });

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
    expect(res.body.unit_price).to.equal(unitPrice);
    expect(res.body.multiplier).to.equal(2.0);
    expect(res.body.service_fee_total).to.equal(expected.serviceFeeTotal);
    expect(res.body.facility_fee_total).to.equal(expected.facilityFeeTotal);
    expect(res.body.total_amount).to.equal(expected.totalAmount);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.total_amount).to.equal(expected.totalAmount);
    expect(order.subtotal).to.equal(expected.subtotal);
    const tickets = await Ticket.find({ order_id: order._id });
    expect(tickets).to.have.lengthOf(1);
    expect(tickets[0].unit_price).to.equal(unitPrice);
  });

  // --- Test 06: Pricing — percentage promo discount applied to subtotal ---
  it('should apply percentage promo code discount to subtotal before fees', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'standard');
    const quantity = randomInt(1, 4);
    const discountPct = randomInt(5, 30);

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Balcony',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });
    await section.save();

    const promo = new PromoCode({
      code: 'SAVE20',
      event_id: event._id,
      discount_type: 'percentage',
      discount_value: discountPct,
      max_uses: 100,
      current_uses: 0,
      valid_from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      min_tickets: 1,
    });
    await promo.save();

    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const subtotal = roundMoney(unitPrice * quantity);
    const discountAmount = roundMoney(subtotal * (discountPct / 100));
    const expected = computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity, discountAmount });

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity,
        promo_code: 'SAVE20',
      });

    expect(res).to.have.status(201);
    expect(res.body.discount_amount).to.equal(discountAmount);
    expect(res.body.total_amount).to.equal(expected.totalAmount);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.discount_amount).to.equal(discountAmount);
    const updatedPromo = await PromoCode.findById(promo._id);
    expect(updatedPromo.current_uses).to.equal(1);
  });

  // --- Test 07: Pricing — fixed promo discount capped at subtotal ---
  it('should cap fixed promo discount at subtotal amount', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);
    const soldCount = soldCountForTier(capacity, 'standard');
    const quantity = randomInt(1, 4);

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Upper Deck',
      capacity,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: 0,
    });
    await section.save();

    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const subtotal = roundMoney(unitPrice * quantity);
    // Fixed discount larger than subtotal → capped at subtotal
    const fixedDiscountValue = subtotal + randomInt(100, 500);

    const promo = new PromoCode({
      code: 'BIGDEAL',
      event_id: event._id,
      discount_type: 'fixed',
      discount_value: fixedDiscountValue,
      max_uses: 100,
      current_uses: 0,
      valid_from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      min_tickets: 1,
    });
    await promo.save();

    const discountAmount = subtotal; // capped
    const expected = computeOrderTotal({ unitPrice, serviceFee, facilityFee, quantity, discountAmount });

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        section_id: section._id.toString(),
        quantity,
        promo_code: 'BIGDEAL',
      });

    expect(res).to.have.status(201);
    expect(res.body.discount_amount).to.equal(subtotal);
    expect(res.body.total_amount).to.equal(expected.totalAmount);

    // DB verification
    const order = await Order.findOne({ user_id: user._id });
    expect(order).to.not.be.null;
    expect(order.discount_amount).to.equal(subtotal);
    const updatedPromo = await PromoCode.findById(promo._id);
    expect(updatedPromo.current_uses).to.equal(1);
  });

  // --- Test 08: Response — all fee components present in response ---
  it('should return all fee component fields in the order response', async () => {
    const basePrice = randomPrice(50, 200);
    const capacity = randomInt(80, 200);

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity,
      base_price: basePrice,
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

    // Ticket creation verification
    const tickets = await Ticket.find({ order_id: order._id });
    expect(tickets).to.have.lengthOf(1);
  });

  // --- Test 09: Validation — negative quantity ---
  it('should return 400 when quantity is negative', async () => {
    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Pit',
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
        quantity: -1,
      });

    expect(res).to.have.status(400);
  });
});
