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
import {
  randomInt, randomPrice, roundMoney,
  computeTicketPrice, computeRefundAmount,
} from '../helpers/pricing.js';

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (
  models = [Payment, Ticket, Order, PromoCode, VenueSection, Event, Venue, User]
) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Bug 4 — Refund with Tiered Penalties and Fee Decomposition', function () {
  this.timeout(15000);

  let user, user2, token, token2, venue;

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
      email: 'refund_customer@test.com',
      password: 'password123',
      role: 'customer',
    });
    await user.save();
    token = generateToken(user._id);

    user2 = new User({
      name: 'Other Customer',
      email: 'other_refund_customer@test.com',
      password: 'password123',
      role: 'customer',
    });
    await user2.save();
    token2 = generateToken(user2._id);

    venue = new Venue({
      name: 'Refund Test Arena',
      address: '456 Refund St',
      city: 'Test City',
      total_capacity: 1000,
    });
    await venue.save();
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

  // --- Helper: create an event with a specific start_date ---
  const createEvent = async (startDate, status = 'on_sale') => {
    const event = new Event({
      title: 'Refund Test Event',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: startDate,
      end_date: new Date(startDate.getTime() + 4 * 60 * 60 * 1000),
      status,
      category: 'concert',
    });
    await event.save();
    return event;
  };

  // --- Helper: create a section ---
  const createSection = async (eventId, soldCount = 0, opts = {}) => {
    const section = new VenueSection({
      event_id: eventId,
      venue_id: venue._id,
      name: 'General Admission',
      capacity: opts.capacity || 100,
      base_price: opts.base_price || 100,
      sold_count: soldCount,
      held_count: 0,
    });
    await section.save();
    return section;
  };

  // --- Helper: create a confirmed order with tickets ---
  const createConfirmedOrder = async (eventId, sectionId, ticketCount, opts = {}) => {
    const unitPrice = opts.unit_price || 100;
    const serviceFee = opts.service_fee || 12;
    const facilityFee = opts.facility_fee || 5;

    const order = new Order({
      user_id: user._id,
      event_id: eventId,
      quantity: ticketCount,
      subtotal: unitPrice * ticketCount,
      service_fee_total: serviceFee * ticketCount,
      facility_fee_total: facilityFee * ticketCount,
      processing_fee: 3,
      discount_amount: 0,
      total_amount: unitPrice * ticketCount + serviceFee * ticketCount + facilityFee * ticketCount + 3,
      status: opts.status || 'confirmed',
      payment_status: 'paid',
      promo_code_id: opts.promo_code_id || null,
      idempotency_key: `order_idem_${Date.now()}_${Math.random()}`,
    });
    await order.save();

    const ticketIds = [];
    for (let i = 0; i < ticketCount; i++) {
      const ticket = new Ticket({
        order_id: order._id,
        event_id: eventId,
        section_id: sectionId,
        user_id: user._id,
        original_user_id: user._id,
        status: 'confirmed',
        unit_price: unitPrice,
        service_fee: serviceFee,
        facility_fee: facilityFee,
      });
      await ticket.save();
      ticketIds.push(ticket._id);
    }

    order.tickets = ticketIds;
    await order.save();

    return order;
  };

  // --- Test 01: should return 404 when order does not exist ---
  it('should return 404 when order does not exist', async () => {
    const fakeOrderId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${fakeOrderId}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res).to.have.status(404);
  });

  // --- Test 02: should return 400 when order is already refunded ---
  it('should return 400 when order is already refunded', async () => {
    const event = await createEvent(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    const section = await createSection(event._id, 2);
    const order = await createConfirmedOrder(event._id, section._id, 2, { status: 'refunded' });

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res).to.have.status(400);
  });

  // --- Test 03: should return 400 when event is within 24 hours ---
  it('should return 400 when event is within 24 hours', async () => {
    // Event in 12 hours
    const event = await createEvent(new Date(Date.now() + 12 * 60 * 60 * 1000));
    const section = await createSection(event._id, 2);
    const order = await createConfirmedOrder(event._id, section._id, 2);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('within 24 hours');
  });

  // --- Test 04: should apply 100% refund tier when event is more than 7 days away ---
  it('should apply 100% refund tier when event is more than 7 days away', async () => {
    const basePrice = randomPrice(50, 200);
    const ticketCount = randomInt(1, 4);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const refund = computeRefundAmount(unitPrice, facilityFee, ticketCount, 1.0, false);

    const event = await createEvent(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    const section = await createSection(event._id, ticketCount);
    const order = await createConfirmedOrder(event._id, section._id, ticketCount, {
      unit_price: unitPrice,
      service_fee: serviceFee,
      facility_fee: facilityFee,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res).to.have.status(200);
    expect(res.body.refund_tier).to.equal('full_refund');
    expect(res.body.refund_percentage).to.equal(100);
    expect(res.body.refund_amount).to.equal(refund.refundAmount);
    expect(res.body.base_refund).to.equal(refund.baseRefund);
    expect(res.body.service_fee_refund).to.equal(0);
    expect(res.body.facility_fee_refund).to.equal(0);
    expect(res.body.processing_fee_refund).to.equal(0);

    const updatedSection = await VenueSection.findById(section._id);
    expect(updatedSection.sold_count).to.equal(0);
  });

  // --- Test 05: should apply 75% refund tier when event is 3-7 days away ---
  it('should apply 75% refund tier when event is 3-7 days away', async () => {
    const basePrice = randomPrice(50, 200);
    const ticketCount = randomInt(1, 4);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const refund = computeRefundAmount(unitPrice, facilityFee, ticketCount, 0.75, false);

    const event = await createEvent(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000));
    const section = await createSection(event._id, ticketCount);
    const order = await createConfirmedOrder(event._id, section._id, ticketCount, {
      unit_price: unitPrice,
      service_fee: serviceFee,
      facility_fee: facilityFee,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res).to.have.status(200);
    expect(res.body.refund_tier).to.equal('75_percent');
    expect(res.body.refund_percentage).to.equal(75);
    expect(res.body.refund_amount).to.equal(refund.refundAmount);
    expect(res.body.base_refund).to.equal(refund.baseRefund);
    expect(res.body.processing_fee_refund).to.equal(0);

    const dbOrder = await Order.findById(order._id);
    expect(dbOrder.status).to.equal('refunded');
    const dbTickets = await Ticket.find({ order_id: order._id });
    dbTickets.forEach(t => expect(t.status).to.equal('refunded'));
  });

  // --- Test 06: should apply 50% refund tier when event is 1-3 days away ---
  it('should apply 50% refund tier when event is 1-3 days away', async () => {
    const basePrice = randomPrice(50, 200);
    const ticketCount = randomInt(1, 4);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const refund = computeRefundAmount(unitPrice, facilityFee, ticketCount, 0.50, false);

    const event = await createEvent(new Date(Date.now() + 36 * 60 * 60 * 1000));
    const section = await createSection(event._id, ticketCount);
    const order = await createConfirmedOrder(event._id, section._id, ticketCount, {
      unit_price: unitPrice,
      service_fee: serviceFee,
      facility_fee: facilityFee,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res).to.have.status(200);
    expect(res.body.refund_tier).to.equal('50_percent');
    expect(res.body.refund_percentage).to.equal(50);
    expect(res.body.refund_amount).to.equal(refund.refundAmount);
    expect(res.body.base_refund).to.equal(refund.baseRefund);
    expect(res.body.processing_fee_refund).to.equal(0);

    const dbOrder = await Order.findById(order._id);
    expect(dbOrder.status).to.equal('refunded');
    const dbTickets = await Ticket.find({ order_id: order._id });
    dbTickets.forEach(t => expect(t.status).to.equal('refunded'));
  });

  // --- Test 07: should include facility fee in organizer cancellation refund ---
  it('should include facility fee in organizer cancellation refund', async () => {
    const basePrice = randomPrice(50, 200);
    const ticketCount = randomInt(1, 4);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const refund = computeRefundAmount(unitPrice, facilityFee, ticketCount, 1.0, true);

    const event = await createEvent(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    await Event.findByIdAndUpdate(event._id, { status: 'cancelled' });

    const section = await createSection(event._id, ticketCount);
    const order = await createConfirmedOrder(event._id, section._id, ticketCount, {
      unit_price: unitPrice,
      service_fee: serviceFee,
      facility_fee: facilityFee,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res).to.have.status(200);
    expect(res.body.refund_tier).to.equal('organizer_cancellation');
    expect(res.body.refund_percentage).to.equal(100);
    expect(res.body.refund_amount).to.equal(refund.refundAmount);
    expect(res.body.base_refund).to.equal(refund.baseRefund);
    expect(res.body.facility_fee_refund).to.equal(refund.facilityFeeRefund);
    expect(res.body.service_fee_refund).to.equal(0);
    expect(res.body.processing_fee_refund).to.equal(0);
  });

  // --- Test 08: should restore section sold_count after refund ---
  it('should restore section sold_count after refund', async () => {
    const ticketCount = randomInt(2, 5);

    const event = await createEvent(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    const section = await createSection(event._id, ticketCount);
    const order = await createConfirmedOrder(event._id, section._id, ticketCount);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res).to.have.status(200);
    expect(res.body.tickets_refunded).to.equal(ticketCount);

    const updatedSection = await VenueSection.findById(section._id);
    expect(updatedSection.sold_count).to.equal(0);
  });

  // --- Test 09: should decrement promo code usage on refund ---
  it('should decrement promo code usage on refund', async () => {
    const ticketCount = randomInt(1, 4);
    const currentUses = randomInt(3, 10);

    const event = await createEvent(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    const section = await createSection(event._id, ticketCount);

    const promo = new PromoCode({
      code: 'REFUNDTEST',
      event_id: event._id,
      discount_type: 'percentage',
      discount_value: 10,
      max_uses: 100,
      current_uses: currentUses,
      valid_from: new Date(Date.now() - 24 * 60 * 60 * 1000),
      valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      min_tickets: 1,
    });
    await promo.save();

    const order = await createConfirmedOrder(event._id, section._id, ticketCount, {
      promo_code_id: promo._id,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res).to.have.status(200);

    const updatedPromo = await PromoCode.findById(promo._id);
    expect(updatedPromo.current_uses).to.equal(currentUses - 1);
  });

  // --- Test 10: should return complete refund breakdown in response ---
  it('should return complete refund breakdown in response', async () => {
    const event = await createEvent(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    const section = await createSection(event._id, 2);
    const order = await createConfirmedOrder(event._id, section._id, 2);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res).to.have.status(200);
    expect(res.body).to.have.property('refund_amount');
    expect(res.body).to.have.property('refund_tier');
    expect(res.body).to.have.property('refund_percentage');
    expect(res.body).to.have.property('base_refund');
    expect(res.body).to.have.property('facility_fee_refund');
    expect(res.body).to.have.property('service_fee_refund');
    expect(res.body).to.have.property('processing_fee_refund');
    expect(res.body).to.have.property('tickets_refunded');
    expect(res.body).to.have.property('order_status');

    // Verify order status changed to refunded
    expect(res.body.order_status).to.equal('refunded');

    // Verify a refund payment record was created
    const refundPayment = await Payment.findOne({ order_id: order._id, type: 'refund' });
    expect(refundPayment).to.not.be.null;
    expect(refundPayment.amount).to.equal(res.body.refund_amount);

    // Verify tickets are marked as refunded
    const tickets = await Ticket.find({ order_id: order._id });
    for (const ticket of tickets) {
      expect(ticket.status).to.equal('refunded');
    }

    // Verify order in DB is refunded
    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.status).to.equal('refunded');
  });

  // --- Test 11: should return 404 when a different user tries to refund another user's order ---
  it('should return 404 when a different user tries to refund another user\'s order', async () => {
    const event = await createEvent(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
    const section = await createSection(event._id, 2);
    const order = await createConfirmedOrder(event._id, section._id, 2);

    const res = await request
      .execute(app)
      .post(`/api/v1/orders/${order._id}/refund`)
      .set('Authorization', `Bearer ${token2}`)
      .send({});

    expect(res).to.have.status(404);
  });
});
