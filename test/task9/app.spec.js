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

    // DB verification: event status unchanged after rejection
    const unchangedEvent = await Event.findById(event._id);
    expect(unchangedEvent.status).to.equal('on_sale');
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
    expect(res.body.error).to.match(/cannot cancel|already cancelled|cannot transition/i);
  });

  // --- Test 03b: Event with status "completed" should be rejected ---
  it('should return 400 when event status is completed', async () => {
    const event = await Event.create({
      title: 'Completed Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'completed',
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
    const basePrice = randomPrice(50, 200);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);

    const event = await Event.create({
      title: 'Big Concert',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 200,
      base_price: basePrice,
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
          unit_price: unitPrice,
          service_fee: serviceFee,
          facility_fee: facilityFee,
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

    // DB verification: refund payment records created
    const refundPayments = await Payment.find({ type: 'refund' });
    expect(refundPayments).to.have.lengthOf(3);
    refundPayments.forEach(p => expect(p.status).to.equal('completed'));

    // DB verification: all orders have cancelled/refunded status
    const orders = await Order.find({ event_id: event._id });
    orders.forEach((o) => {
      expect(['cancelled', 'refunded']).to.include(o.status);
    });
  });

  // --- Test 05: Calculate refund as base price plus facility fee ---
  it('should calculate refund as base price plus facility fee', async () => {
    const basePrice = randomPrice(50, 200);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const ticketCount = 2;
    const { refundAmount } = computeRefundAmount(unitPrice, facilityFee, ticketCount, 1.0, true);

    const event = await Event.create({
      title: 'Refund Calc Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 100,
      base_price: basePrice,
      sold_count: ticketCount,
      held_count: 0,
    });

    const order = await Order.create({
      user_id: otherUser._id,
      event_id: event._id,
      quantity: ticketCount,
      status: 'confirmed',
      payment_status: 'paid',
      idempotency_key: `refund-calc-order-${Date.now()}`,
    });

    for (let i = 0; i < ticketCount; i++) {
      await Ticket.create({
        order_id: order._id,
        event_id: event._id,
        section_id: section._id,
        user_id: otherUser._id,
        original_user_id: otherUser._id,
        status: 'confirmed',
        unit_price: unitPrice,
        service_fee: serviceFee,
        facility_fee: facilityFee,
      });
    }

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);
    expect(res.body.refunds).to.be.an('array').with.lengthOf(1);
    expect(res.body.refunds[0].refund_amount).to.equal(refundAmount);

    // DB verification: refund payment record matches
    const refundPayment = await Payment.findOne({ order_id: order._id, type: 'refund' });
    expect(refundPayment).to.not.be.null;
    expect(refundPayment.amount).to.equal(refundAmount);

    // DB verification: order status updated
    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.status).to.equal('refunded');
  });

  // --- Test 06: Set all confirmed tickets to cancelled status ---
  it('should set all confirmed tickets to cancelled status', async () => {
    const basePrice = randomPrice(50, 200);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);

    const event = await Event.create({
      title: 'Ticket Cancel Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Floor',
      capacity: 200,
      base_price: basePrice,
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
          unit_price: unitPrice,
          service_fee: serviceFee,
          facility_fee: facilityFee,
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

    // DB verification: all orders updated to refunded status
    const orderCount = res.body.orders_processed;
    const dbOrders = await Order.find({ event_id: event._id, status: 'refunded' });
    expect(dbOrders).to.have.lengthOf(orderCount); // should match orders_processed
    dbOrders.forEach(o => {
      expect(o.payment_status).to.equal('refunded');
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

    const section = await VenueSection.create({
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

    const updatedSection = await VenueSection.findById(section._id);
    expect(updatedSection.sold_count).to.equal(0);
    expect(updatedSection.held_count).to.equal(0);
  });

  // --- Test 08: Decrement promo code usage for each refunded order ---
  it('should decrement promo code usage for each refunded order', async () => {
    const basePrice = randomPrice(50, 200);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const initialUses = randomInt(5, 20);

    const event = await Event.create({
      title: 'Promo Decrement Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Mezzanine',
      capacity: 300,
      base_price: basePrice,
      sold_count: 4,
      held_count: 0,
    });

    const promo = await PromoCode.create({
      code: 'CANCEL20',
      event_id: event._id,
      discount_type: 'percentage',
      discount_value: 20,
      max_uses: 100,
      current_uses: initialUses,
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
          unit_price: unitPrice,
          service_fee: serviceFee,
          facility_fee: facilityFee,
        });
      }
    }

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);

    // current_uses was initialUses, 2 orders refunded => should be initialUses - 2
    const updatedPromo = await PromoCode.findById(promo._id);
    expect(updatedPromo.current_uses).to.equal(initialUses - 2);
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

    const section = await VenueSection.create({
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

    await VenueSection.create({
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

    // DB verification: event status is cancelled even with zero orders
    const updatedEvent = await Event.findById(event._id);
    expect(updatedEvent.status).to.equal('cancelled');
  });

  // --- Test 11: Return complete cascade summary in response ---
  it('should return complete cascade summary in response', async () => {
    const basePrice = randomPrice(50, 200);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const ticketsPerOrder = 2;
    const { refundAmount } = computeRefundAmount(unitPrice, facilityFee, ticketsPerOrder, 1.0, true);

    const event = await Event.create({
      title: 'Summary Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Main Hall',
      capacity: 500,
      base_price: basePrice,
      sold_count: 4,
      held_count: 1,
    });

    // Create 2 confirmed orders with 2 tickets each
    const orderIds = [];
    for (let i = 0; i < 2; i++) {
      const order = await Order.create({
        user_id: otherUser._id,
        event_id: event._id,
        quantity: ticketsPerOrder,
        status: 'confirmed',
        payment_status: 'paid',
        idempotency_key: `summary-order-${i}-${Date.now()}`,
      });
      orderIds.push(order._id.toString());

      for (let j = 0; j < ticketsPerOrder; j++) {
        await Ticket.create({
          order_id: order._id,
          event_id: event._id,
          section_id: section._id,
          user_id: otherUser._id,
          original_user_id: otherUser._id,
          status: 'confirmed',
          unit_price: unitPrice,
          service_fee: serviceFee,
          facility_fee: facilityFee,
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
      unit_price: unitPrice,
      service_fee: serviceFee,
      facility_fee: facilityFee,
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
      expect(refund.tickets_cancelled).to.equal(ticketsPerOrder);
      expect(refund.refund_amount).to.equal(refundAmount);
    });

    // DB verification: refund payment records match refunds count
    const refundPayments = await Payment.find({ type: 'refund' });
    expect(refundPayments).to.have.lengthOf(res.body.refunds.length);

    // DB verification: all orders have cancelled/refunded status
    const allOrders = await Order.find({ event_id: event._id, status: { $in: ['confirmed', 'cancelled', 'refunded'] } });
    allOrders.forEach((o) => {
      expect(['cancelled', 'refunded']).to.include(o.status);
    });
  });

  // --- Test 12: should handle partial failure in bulk refund ---
  it('should handle partial failure in bulk refund', async () => {
    const basePrice = randomPrice(50, 200);
    const { unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0);
    const ticketsPerOrder = 2;
    const { refundAmount } = computeRefundAmount(unitPrice, facilityFee, ticketsPerOrder, 1.0, true);

    const event = await Event.create({
      title: 'Partial Failure Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Partial Section',
      capacity: 200,
      base_price: basePrice,
      sold_count: 6,
      held_count: 0,
    });

    // Create 3 confirmed orders
    const orders = [];
    for (let i = 0; i < 3; i++) {
      const order = await Order.create({
        user_id: otherUser._id,
        event_id: event._id,
        quantity: ticketsPerOrder,
        status: 'confirmed',
        payment_status: 'paid',
        idempotency_key: `partial-fail-order-${i}-${Date.now()}`,
      });
      orders.push(order);

      // Create tickets for first 2 orders only; order3 has no tickets
      if (i < 2) {
        for (let j = 0; j < ticketsPerOrder; j++) {
          await Ticket.create({
            order_id: order._id,
            event_id: event._id,
            section_id: section._id,
            user_id: otherUser._id,
            original_user_id: otherUser._id,
            status: 'confirmed',
            unit_price: unitPrice,
            service_fee: serviceFee,
            facility_fee: facilityFee,
          });
        }
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

    // Orders with tickets should have non-zero refund_amount
    const ordersWithTickets = res.body.refunds.filter((r) => r.refund_amount > 0);
    expect(ordersWithTickets).to.have.lengthOf(2);
    ordersWithTickets.forEach((r) => {
      expect(r.tickets_cancelled).to.equal(ticketsPerOrder);
      expect(r.refund_amount).to.equal(refundAmount);
    });

    // Event should still be cancelled
    const updatedEvent = await Event.findById(event._id);
    expect(updatedEvent.status).to.equal('cancelled');

    // DB verification: payment records created for orders with tickets
    const refundPayments = await Payment.find({ type: 'refund' });
    expect(refundPayments.length).to.be.at.least(2);
  });
});
