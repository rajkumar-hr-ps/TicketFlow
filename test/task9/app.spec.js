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
import { Order } from '../../src/models/Order.js';
import { Ticket } from '../../src/models/Ticket.js';
import { Payment } from '../../src/models/Payment.js';
import { PromoCode } from '../../src/models/PromoCode.js';

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (
  models = [Payment, Ticket, Order, PromoCode, Section, Event, Venue, User]
) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Bug 9 — Event Cancellation with Bulk Refund Cascade', function () {
  this.timeout(15000);

  let organizer, otherUser, organizerToken, otherUserToken, venue;

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
      name: 'Organizer',
      email: 'organizer@test.com',
      password: 'password123',
      role: 'organizer',
    });
    await organizer.save();
    organizerToken = generateToken(organizer._id);

    otherUser = new User({
      name: 'OtherUser',
      email: 'otheruser@test.com',
      password: 'password123',
      role: 'customer',
    });
    await otherUser.save();
    otherUserToken = generateToken(otherUser._id);

    venue = new Venue({
      name: 'Cancellation Arena',
      address: '789 Cancel St',
      city: 'Test City',
      total_capacity: 5000,
    });
    await venue.save();
  });

  beforeEach(async () => {
    await cleanupModels([Payment, Ticket, Order, PromoCode, Section, Event]);
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

  // --- Test 01: Event does not exist ---
  it('should return 404 when event does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${fakeId}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(404);
  });

  // --- Test 02: User is not the organizer ---
  it('should return 404 when user is not the organizer', async () => {
    const event = await Event.create({
      title: 'Not My Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${otherUserToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(404);
  });

  // --- Test 03: Event is already cancelled ---
  it('should return 400 when event is already cancelled', async () => {
    const event = await Event.create({
      title: 'Already Cancelled Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'cancelled',
      category: 'concert',
    });

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(400);
  });

  // --- Test 04: Refund all confirmed orders when event is cancelled ---
  it('should refund all confirmed orders when event is cancelled', async () => {
    const event = await Event.create({
      title: 'Big Concert',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 200,
      base_price: 100,
      sold_count: 6,
      held_count: 0,
    });

    // Create 3 confirmed orders with 2 tickets each
    for (let i = 0; i < 3; i++) {
      const order = await Order.create({
        user_id: otherUser._id,
        event_id: event._id,
        quantity: 2,
        status: 'confirmed',
        payment_status: 'paid',
        idempotency_key: `cancel-test-order-${i}-${Date.now()}`,
      });

      for (let j = 0; j < 2; j++) {
        await Ticket.create({
          order_id: order._id,
          event_id: event._id,
          section_id: section._id,
          user_id: otherUser._id,
          original_user_id: otherUser._id,
          status: 'confirmed',
          unit_price: 100,
          service_fee: 12,
          facility_fee: 5,
        });
      }
    }

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);
    expect(res.body.orders_processed).to.equal(3);
    expect(res.body.refunds).to.be.an('array').with.lengthOf(3);
    res.body.refunds.forEach((refund) => {
      expect(refund.status).to.equal('success');
    });
  });

  // --- Test 05: Calculate refund as base price plus facility fee ---
  it('should calculate refund as base price plus facility fee', async () => {
    const event = await Event.create({
      title: 'Refund Calc Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 100,
      base_price: 100,
      sold_count: 2,
      held_count: 0,
    });

    const order = await Order.create({
      user_id: otherUser._id,
      event_id: event._id,
      quantity: 2,
      status: 'confirmed',
      payment_status: 'paid',
      idempotency_key: `refund-calc-order-${Date.now()}`,
    });

    // 2 tickets: unit_price=100, facility_fee=5 each
    for (let i = 0; i < 2; i++) {
      await Ticket.create({
        order_id: order._id,
        event_id: event._id,
        section_id: section._id,
        user_id: otherUser._id,
        original_user_id: otherUser._id,
        status: 'confirmed',
        unit_price: 100,
        service_fee: 12,
        facility_fee: 5,
      });
    }

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);
    expect(res.body.refunds).to.be.an('array').with.lengthOf(1);
    // 2 tickets * (100 base + 5 facility) = 210
    expect(res.body.refunds[0].refund_amount).to.equal(210);
  });

  // --- Test 06: Set all confirmed tickets to cancelled status ---
  it('should set all confirmed tickets to cancelled status', async () => {
    const event = await Event.create({
      title: 'Ticket Cancel Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Floor',
      capacity: 200,
      base_price: 100,
      sold_count: 6,
      held_count: 0,
    });

    // 3 orders x 2 tickets = 6 confirmed tickets
    for (let i = 0; i < 3; i++) {
      const order = await Order.create({
        user_id: otherUser._id,
        event_id: event._id,
        quantity: 2,
        status: 'confirmed',
        payment_status: 'paid',
        idempotency_key: `ticket-cancel-order-${i}-${Date.now()}`,
      });

      for (let j = 0; j < 2; j++) {
        await Ticket.create({
          order_id: order._id,
          event_id: event._id,
          section_id: section._id,
          user_id: otherUser._id,
          original_user_id: otherUser._id,
          status: 'confirmed',
          unit_price: 100,
          service_fee: 12,
          facility_fee: 5,
        });
      }
    }

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);

    // Verify all 6 tickets are cancelled in DB
    const tickets = await Ticket.find({ event_id: event._id });
    expect(tickets).to.have.lengthOf(6);
    tickets.forEach((ticket) => {
      expect(ticket.status).to.equal('cancelled');
    });
  });

  // --- Test 07: Reset section counters to zero ---
  it('should reset section counters to zero', async () => {
    const event = await Event.create({
      title: 'Section Reset Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Balcony',
      capacity: 500,
      base_price: 75,
      sold_count: 50,
      held_count: 5,
    });

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);

    const updatedSection = await Section.findById(section._id);
    expect(updatedSection.sold_count).to.equal(0);
    expect(updatedSection.held_count).to.equal(0);
  });

  // --- Test 08: Decrement promo code usage for each refunded order ---
  it('should decrement promo code usage for each refunded order', async () => {
    const event = await Event.create({
      title: 'Promo Decrement Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Mezzanine',
      capacity: 300,
      base_price: 100,
      sold_count: 4,
      held_count: 0,
    });

    const promo = await PromoCode.create({
      code: 'CANCEL20',
      event_id: event._id,
      discount_type: 'percentage',
      discount_value: 20,
      max_uses: 100,
      current_uses: 5,
      valid_from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      valid_to: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    // 2 orders that used the same promo code
    for (let i = 0; i < 2; i++) {
      const order = await Order.create({
        user_id: otherUser._id,
        event_id: event._id,
        quantity: 2,
        status: 'confirmed',
        payment_status: 'paid',
        promo_code_id: promo._id,
        idempotency_key: `promo-cancel-order-${i}-${Date.now()}`,
      });

      for (let j = 0; j < 2; j++) {
        await Ticket.create({
          order_id: order._id,
          event_id: event._id,
          section_id: section._id,
          user_id: otherUser._id,
          original_user_id: otherUser._id,
          status: 'confirmed',
          unit_price: 100,
          service_fee: 12,
          facility_fee: 5,
        });
      }
    }

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);

    // current_uses was 5, 2 orders refunded => should be 3
    const updatedPromo = await PromoCode.findById(promo._id);
    expect(updatedPromo.current_uses).to.equal(3);
  });

  // --- Test 09: Clean up Redis hold keys for held tickets ---
  it('should clean up Redis hold keys for held tickets', async () => {
    const event = await Event.create({
      title: 'Redis Cleanup Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Pit',
      capacity: 100,
      base_price: 150,
      sold_count: 0,
      held_count: 2,
    });

    // Create a dummy order for held tickets (required by Ticket schema)
    const dummyOrder = await Order.create({
      user_id: otherUser._id,
      event_id: event._id,
      quantity: 2,
      status: 'pending',
      payment_status: 'pending',
      idempotency_key: `redis-held-order-${Date.now()}`,
    });

    // Create 2 held tickets and set Redis keys
    const heldTickets = [];
    for (let i = 0; i < 2; i++) {
      const ticket = await Ticket.create({
        order_id: dummyOrder._id,
        event_id: event._id,
        section_id: section._id,
        user_id: otherUser._id,
        original_user_id: otherUser._id,
        status: 'held',
        unit_price: 150,
        service_fee: 18,
        facility_fee: 7,
        hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
      });
      heldTickets.push(ticket);

      // Set Redis hold key: hold:${sectionId}:${ticketId}
      const key = `hold:${section._id}:${ticket._id}`;
      await redisClient.set(key, '1', 'EX', 300);
    }

    // Verify Redis keys exist before cancellation
    for (const ticket of heldTickets) {
      const key = `hold:${section._id}:${ticket._id}`;
      const exists = await redisClient.exists(key);
      expect(exists).to.equal(1);
    }

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);

    // Verify Redis keys have been cleaned up
    for (const ticket of heldTickets) {
      const key = `hold:${section._id}:${ticket._id}`;
      const exists = await redisClient.exists(key);
      expect(exists).to.equal(0);
    }
  });

  // --- Test 10: Handle event with no orders gracefully ---
  it('should handle event with no orders gracefully', async () => {
    const event = await Event.create({
      title: 'Empty Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Empty Section',
      capacity: 100,
      base_price: 50,
      sold_count: 0,
      held_count: 0,
    });

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);
    expect(res.body.orders_processed).to.equal(0);
    expect(res.body.refunds).to.be.an('array').with.lengthOf(0);
  });

  // --- Test 11: Return complete cascade summary in response ---
  it('should return complete cascade summary in response', async () => {
    const event = await Event.create({
      title: 'Summary Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await Section.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Main Hall',
      capacity: 500,
      base_price: 100,
      sold_count: 4,
      held_count: 1,
    });

    // Create 2 confirmed orders with 2 tickets each
    const orderIds = [];
    for (let i = 0; i < 2; i++) {
      const order = await Order.create({
        user_id: otherUser._id,
        event_id: event._id,
        quantity: 2,
        status: 'confirmed',
        payment_status: 'paid',
        idempotency_key: `summary-order-${i}-${Date.now()}`,
      });
      orderIds.push(order._id.toString());

      for (let j = 0; j < 2; j++) {
        await Ticket.create({
          order_id: order._id,
          event_id: event._id,
          section_id: section._id,
          user_id: otherUser._id,
          original_user_id: otherUser._id,
          status: 'confirmed',
          unit_price: 100,
          service_fee: 12,
          facility_fee: 5,
        });
      }
    }

    // Create 1 held ticket with Redis key
    const heldOrder = await Order.create({
      user_id: otherUser._id,
      event_id: event._id,
      quantity: 1,
      status: 'pending',
      payment_status: 'pending',
      idempotency_key: `summary-held-order-${Date.now()}`,
    });

    const heldTicket = await Ticket.create({
      order_id: heldOrder._id,
      event_id: event._id,
      section_id: section._id,
      user_id: otherUser._id,
      original_user_id: otherUser._id,
      status: 'held',
      unit_price: 100,
      service_fee: 12,
      facility_fee: 5,
      hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
    });

    const holdRedisKey = `hold:${section._id}:${heldTicket._id}`;
    await redisClient.set(holdRedisKey, '1', 'EX', 300);

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);

    // Verify all response fields
    expect(res.body).to.have.property('event_id');
    expect(res.body.event_id.toString()).to.equal(event._id.toString());
    expect(res.body.status).to.equal('cancelled');
    expect(res.body.orders_processed).to.equal(2);
    expect(res.body.refunds).to.be.an('array').with.lengthOf(2);
    expect(res.body.held_tickets_cancelled).to.equal(1);

    // Verify each refund entry structure
    res.body.refunds.forEach((refund) => {
      expect(refund).to.have.property('order_id');
      expect(refund).to.have.property('refund_amount');
      expect(refund).to.have.property('tickets_cancelled');
      expect(refund).to.have.property('status');
      expect(refund.status).to.equal('success');
      expect(refund.tickets_cancelled).to.equal(2);
      expect(refund.refund_amount).to.equal(210);
    });
  });
});
