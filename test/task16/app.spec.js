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

describe('Feature 6 — Refund Processing with Tiered Penalties and Fee Decomposition', function () {
  this.timeout(15000);

  let user, token, venue, event, section;

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

    user = await User.create({
      name: 'Refund User',
      email: 'refund_feat@test.com',
      password: 'password123',
      role: 'customer',
    });
    token = generateToken(user._id);

    venue = await Venue.create({
      name: 'Refund Arena',
      address: '600 Refund St',
      city: 'Test City',
      total_capacity: 5000,
    });
  });

  beforeEach(async () => {
    await Payment.deleteMany({});
    await Ticket.deleteMany({});
    await Order.deleteMany({});
    await PromoCode.deleteMany({});
    await VenueSection.deleteMany({});
    await Event.deleteMany({});

    // Create event 10 days from now (full refund tier)
    event = await Event.create({
      title: 'Refund Concert',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 50,
      held_count: 0,
    });
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

  const createConfirmedOrder = async (ticketCount = 2, eventOverride, sectionOverride) => {
    const evt = eventOverride || event;
    const sec = sectionOverride || section;
    const unitPrice = sec.base_price;

    const orderId = new mongoose.Types.ObjectId();
    const tickets = [];

    for (let i = 0; i < ticketCount; i++) {
      const ticket = await Ticket.create({
        order_id: orderId,
        event_id: evt._id,
        section_id: sec._id,
        user_id: user._id,
        original_user_id: user._id,
        status: 'confirmed',
        unit_price: unitPrice,
        service_fee: 12,
        facility_fee: 5,
      });
      tickets.push(ticket);
    }

    const order = await Order.create({
      _id: orderId,
      user_id: user._id,
      event_id: evt._id,
      tickets: tickets.map((t) => t._id),
      quantity: ticketCount,
      subtotal: unitPrice * ticketCount,
      service_fee_total: 12 * ticketCount,
      facility_fee_total: 5 * ticketCount,
      processing_fee: 3,
      total_amount: (unitPrice + 12 + 5) * ticketCount + 3,
      status: 'confirmed',
      payment_status: 'paid',
      idempotency_key: new mongoose.Types.ObjectId().toString(),
    });

    return { order, tickets };
  };

  // --- Test 01: should return 404 when order does not exist ---
  it('should return 404 when order does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${fakeId}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(404);
  });

  // --- Test 02: should return 404 when user does not own the order ---
  it('should return 404 when user does not own the order', async () => {
    const otherUser = await User.create({
      name: 'Other',
      email: 'other_refund@test.com',
      password: 'password123',
      role: 'customer',
    });
    const otherToken = generateToken(otherUser._id);

    const { order } = await createConfirmedOrder();

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res).to.have.status(404);
  });

  // --- Test 03: should return 400 when order is already refunded ---
  it('should return 400 when order is already refunded', async () => {
    const { order } = await createConfirmedOrder();
    order.status = 'refunded';
    order.payment_status = 'refunded';
    await order.save();

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('not eligible');
  });

  // --- Test 04: should return 400 when event is within 24 hours ---
  it('should return 400 when event is within 24 hours', async () => {
    const soonEvent = await Event.create({
      title: 'Soon Event',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 12 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 16 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const soonSection = await VenueSection.create({
      event_id: soonEvent._id,
      venue_id: venue._id,
      name: 'Soon Section',
      capacity: 100,
      base_price: 100,
      sold_count: 10,
      held_count: 0,
    });

    const { order } = await createConfirmedOrder(1, soonEvent, soonSection);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('24 hours');
  });

  // --- Test 05: should apply 100% refund when event is more than 7 days away ---
  it('should apply 100% refund when event is more than 7 days away', async () => {
    const { order } = await createConfirmedOrder(2);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.refund_tier).to.equal('full_refund');
    expect(res.body.refund_percentage).to.equal(100);
    // base_refund = 100 * 2 tickets * 100% = 200
    expect(res.body.base_refund).to.equal(200);
    expect(res.body.refund_amount).to.equal(200);
  });

  // --- Test 06: should apply 75% refund when event is 3-7 days away ---
  it('should apply 75% refund when event is 3-7 days away', async () => {
    const medEvent = await Event.create({
      title: 'Med Event',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const medSection = await VenueSection.create({
      event_id: medEvent._id,
      venue_id: venue._id,
      name: 'Med Section',
      capacity: 100,
      base_price: 200,
      sold_count: 10,
      held_count: 0,
    });

    const { order } = await createConfirmedOrder(1, medEvent, medSection);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.refund_tier).to.equal('75_percent');
    expect(res.body.refund_percentage).to.equal(75);
    // base_refund = 200 * 1 ticket * 75% = 150
    expect(res.body.base_refund).to.equal(150);
  });

  // --- Test 07: should apply 50% refund when event is 1-3 days away ---
  it('should apply 50% refund when event is 1-3 days away', async () => {
    const closeEvent = await Event.create({
      title: 'Close Event',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const closeSection = await VenueSection.create({
      event_id: closeEvent._id,
      venue_id: venue._id,
      name: 'Close Section',
      capacity: 100,
      base_price: 100,
      sold_count: 10,
      held_count: 0,
    });

    const { order } = await createConfirmedOrder(2, closeEvent, closeSection);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.refund_tier).to.equal('50_percent');
    expect(res.body.refund_percentage).to.equal(50);
    // base_refund = 100 * 2 * 50% = 100
    expect(res.body.base_refund).to.equal(100);
  });

  // --- Test 08: should include facility fee refund on organizer cancellation ---
  it('should include facility fee refund on organizer cancellation', async () => {
    const cancelledEvent = await Event.create({
      title: 'Cancelled Event',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'cancelled',
      category: 'concert',
    });

    const cancelSection = await VenueSection.create({
      event_id: cancelledEvent._id,
      venue_id: venue._id,
      name: 'Cancel Section',
      capacity: 100,
      base_price: 100,
      sold_count: 10,
      held_count: 0,
    });

    const { order } = await createConfirmedOrder(2, cancelledEvent, cancelSection);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.refund_tier).to.equal('organizer_cancellation');
    expect(res.body.facility_fee_refund).to.equal(10); // 5 * 2 tickets
    expect(res.body.base_refund).to.equal(200); // 100% of base
    expect(res.body.refund_amount).to.equal(210); // 200 + 10
  });

  // --- Test 09: should restore section sold_count after refund ---
  it('should restore section sold_count after refund', async () => {
    const { order } = await createConfirmedOrder(3);
    const beforeSection = await VenueSection.findById(section._id);
    const soldBefore = beforeSection.sold_count;

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);

    const afterSection = await VenueSection.findById(section._id);
    expect(afterSection.sold_count).to.equal(soldBefore - 3);
  });

  // --- Test 10: should set tickets to refunded status ---
  it('should set tickets to refunded status', async () => {
    const { order, tickets } = await createConfirmedOrder(2);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.tickets_refunded).to.equal(2);

    for (const t of tickets) {
      const updated = await Ticket.findById(t._id);
      expect(updated.status).to.equal('refunded');
    }
  });

  // --- Test 11: should set order status to refunded ---
  it('should set order status to refunded', async () => {
    const { order } = await createConfirmedOrder(2);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);
    expect(res.body.order_status).to.equal('refunded');

    const updated = await Order.findById(order._id);
    expect(updated.status).to.equal('refunded');
    expect(updated.payment_status).to.equal('refunded');
  });

  // --- Test 12: should create refund payment record ---
  it('should create refund payment record', async () => {
    const { order } = await createConfirmedOrder(2);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(200);

    const refundPayment = await Payment.findOne({
      order_id: order._id,
      type: 'refund',
    });
    expect(refundPayment).to.not.be.null;
    expect(refundPayment.status).to.equal('completed');
    expect(refundPayment.amount).to.equal(res.body.refund_amount);
  });

  // --- Test 13: should partially refund 2 of 3 tickets ---
  it('should partially refund 2 of 3 tickets', async () => {
    const { order, tickets } = await createConfirmedOrder(3);
    const soldBefore = (await VenueSection.findById(section._id)).sold_count;

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ticket_ids: [tickets[0]._id.toString(), tickets[1]._id.toString()] });

    expect(res).to.have.status(200);
    expect(res.body.tickets_refunded).to.equal(2);
    expect(res.body.order_status).to.equal('partially_refunded');

    // Verify DB: refunded tickets
    const t0 = await Ticket.findById(tickets[0]._id);
    const t1 = await Ticket.findById(tickets[1]._id);
    const t2 = await Ticket.findById(tickets[2]._id);
    expect(t0.status).to.equal('refunded');
    expect(t1.status).to.equal('refunded');
    expect(t2.status).to.equal('confirmed');

    // Verify DB: order status
    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.status).to.equal('partially_refunded');

    // Verify DB: section sold_count decreased by 2
    const updatedSection = await VenueSection.findById(section._id);
    expect(updatedSection.sold_count).to.equal(soldBefore - 2);
  });

  // --- Test 14: should partially refund 1 of 4 tickets ---
  it('should partially refund 1 of 4 tickets', async () => {
    const { order, tickets } = await createConfirmedOrder(4);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ticket_ids: [tickets[0]._id.toString()] });

    expect(res).to.have.status(200);

    // Verify DB: 1 refunded, 3 confirmed
    const refundedTicket = await Ticket.findById(tickets[0]._id);
    expect(refundedTicket.status).to.equal('refunded');

    const confirmedTickets = await Ticket.find({
      _id: { $in: [tickets[1]._id, tickets[2]._id, tickets[3]._id] },
    });
    confirmedTickets.forEach((t) => expect(t.status).to.equal('confirmed'));

    // Verify DB: order status
    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.status).to.equal('partially_refunded');
  });
});
