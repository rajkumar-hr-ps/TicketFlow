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
  computeTicketPrice,
} from '../helpers/pricing.js';

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (
  models = [Payment, Ticket, Order, PromoCode, VenueSection, Event, Venue, User]
) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Bug 3 — Hold-to-Purchase Confirmation with Counter Transitions', function () {
  this.timeout(15000);

  let user, user2, token, token2, venue, event;

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

    user2 = new User({
      name: 'Other Customer',
      email: 'other_customer@test.com',
      password: 'password123',
      role: 'customer',
    });
    await user2.save();
    token2 = generateToken(user2._id);

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
    await Event.findByIdAndUpdate(event._id, { status: 'on_sale' });
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

  // --- Helper: create a dummy order for ticket creation ---
  const createDummyOrder = async (opts = {}) => {
    const up = opts.unitPrice || 100;
    const sf = opts.serviceFee || 12;
    const ff = opts.facilityFee || 5;
    return await Order.create({
      user_id: user._id,
      event_id: event._id,
      quantity: 1,
      subtotal: up,
      service_fee_total: sf,
      facility_fee_total: ff,
      processing_fee: 3,
      total_amount: roundMoney(up + sf + ff + 3),
      status: 'pending',
      payment_status: 'pending',
      idempotency_key: new mongoose.Types.ObjectId().toString(),
    });
  };

  // --- Helper: create a held ticket with Redis key ---
  const createHeldTicket = async (section, order, opts = {}) => {
    const up = opts.unitPrice || 100;
    const sf = opts.serviceFee || 12;
    const ff = opts.facilityFee || 5;
    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: user._id,
      original_user_id: user._id,
      status: 'held',
      unit_price: up,
      service_fee: sf,
      facility_fee: ff,
      hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
    });

    await redisClient.set(`hold:${section._id}:${ticket._id}`, '1', 'EX', 300);

    return ticket;
  };

  // --- Test 01: 404 when ticket does not exist ---
  it('should return 404 when ticket does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${fakeId}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(404);
  });

  // --- Test 02: 400 when ticket is already confirmed ---
  it('should return 400 when ticket is already confirmed', async () => {
    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 50,
      held_count: 0,
    });

    const order = await createDummyOrder();

    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: user._id,
      original_user_id: user._id,
      status: 'confirmed',
      unit_price: 100,
      service_fee: 12,
      facility_fee: 5,
      hold_expires_at: null,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(400);
    expect(res.body.error || res.body.message).to.include('only held');
  });

  // --- Test 03: should decrement section held_count after confirming ---
  it('should decrement section held_count after confirming', async () => {
    const basePrice = randomPrice(50, 200);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const soldCount = randomInt(10, 80);
    const heldCount = randomInt(2, 10);

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: heldCount,
    });

    const order = await createDummyOrder({ unitPrice, serviceFee, facilityFee });
    const ticket = await createHeldTicket(section, order, { unitPrice, serviceFee, facilityFee });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);

    const updatedSection = await VenueSection.findById(section._id);
    expect(updatedSection.held_count).to.equal(heldCount - 1);
    expect(updatedSection.sold_count).to.equal(soldCount + 1);
  });

  // --- Test 04: should increment section sold_count after confirming ---
  it('should increment section sold_count after confirming', async () => {
    const basePrice = randomPrice(50, 200);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const soldCount = randomInt(10, 80);
    const heldCount = randomInt(2, 10);

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: basePrice,
      sold_count: soldCount,
      held_count: heldCount,
    });

    const order = await createDummyOrder({ unitPrice, serviceFee, facilityFee });
    const ticket = await createHeldTicket(section, order, { unitPrice, serviceFee, facilityFee });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);

    const updatedSection = await VenueSection.findById(section._id);
    expect(updatedSection.sold_count).to.equal(soldCount + 1);
    expect(updatedSection.held_count).to.equal(heldCount - 1);
  });

  // --- Test 05: should remove Redis hold key after confirming ---
  it('should remove Redis hold key after confirming', async () => {
    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 50,
      held_count: 5,
    });

    const order = await createDummyOrder();
    const ticket = await createHeldTicket(section, order);

    const holdKey = `hold:${section._id}:${ticket._id}`;

    // Verify the key exists before confirmation
    const existsBefore = await redisClient.exists(holdKey);
    expect(existsBefore).to.equal(1);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);

    const existsAfter = await redisClient.exists(holdKey);
    expect(existsAfter).to.equal(0);
  });

  // --- Test 06: should set event to sold_out when last available seat is confirmed ---
  it('should set event to sold_out when last available seat is confirmed', async () => {
    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 1,
      base_price: 100,
      sold_count: 0,
      held_count: 1,
    });

    const order = await createDummyOrder();
    const ticket = await createHeldTicket(section, order);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);

    const updatedEvent = await Event.findById(event._id);
    expect(updatedEvent.status).to.equal('sold_out');
  });

  // --- Test 07: should NOT set event to sold_out when seats remain ---
  it('should NOT set event to sold_out when seats remain', async () => {
    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 50,
      held_count: 5,
    });

    const order = await createDummyOrder();
    const ticket = await createHeldTicket(section, order);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);

    const updatedEvent = await Event.findById(event._id);
    expect(updatedEvent.status).to.equal('on_sale');
  });

  // --- Test 08: should update ticket fields correctly after confirmation ---
  it('should update ticket fields correctly after confirmation', async () => {
    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 50,
      held_count: 5,
    });

    const order = await createDummyOrder();
    const ticket = await createHeldTicket(section, order);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);

    // Response body validation
    expect(res.body.ticket || res.body).to.have.property('status', 'confirmed');

    const updatedTicket = await Ticket.findById(ticket._id);
    expect(updatedTicket.status).to.equal('confirmed');
    expect(updatedTicket.hold_expires_at).to.be.null;
  });

  // --- Test 09: should keep event on_sale when one section sells out but another has seats ---
  it('should keep event on_sale when one section sells out but another has seats', async () => {
    const sectionA = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 1,
      base_price: 200,
      sold_count: 0,
      held_count: 1,
    });

    await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General Admission',
      capacity: 100,
      base_price: 50,
      sold_count: 0,
      held_count: 0,
    });

    const order = await createDummyOrder();
    const ticket = await createHeldTicket(sectionA, order);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/confirm`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);

    const updatedEvent = await Event.findById(event._id);
    expect(updatedEvent.status).to.equal('on_sale');
  });
});
