import { use, expect } from 'chai';
import chaiHttp from 'chai-http';
import { request } from 'chai-http';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
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
import { WebhookLog } from '../../src/models/WebhookLog.js';

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (
  models = [Payment, Ticket, Order, PromoCode, VenueSection, Event, Venue, User]
) => {
  await Promise.all([...models.map((M) => M.deleteMany({})), WebhookLog.deleteMany({})]);
};

const signWebhook = (body) => {
  return crypto
    .createHmac('sha256', config.paymentWebhookSecret)
    .update(JSON.stringify(body))
    .digest('hex');
};

describe('Bug 8 — Payment Webhook Handler Security', function () {
  this.timeout(15000);

  let user, venue, event, section;

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
      name: 'WebhookUser',
      email: 'webhookuser@test.com',
      password: 'password123',
      role: 'customer',
    });
    await user.save();

    venue = new Venue({
      name: 'Webhook Arena',
      address: '789 Webhook St',
      city: 'Test City',
      total_capacity: 5000,
    });
    await venue.save();

    event = new Event({
      title: 'Webhook Concert',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
    await event.save();

    section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 200,
      base_price: 79,
      sold_count: 0,
      held_count: 0,
    });
    await section.save();
  });

  beforeEach(async () => {
    await cleanupModels([Payment, Ticket, Order]);
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

  // --- Test 01: Missing signature header ---
  it('should reject webhook with missing signature header', async () => {
    const body = {
      payment_id: new mongoose.Types.ObjectId().toString(),
      status: 'completed',
      amount: 237,
      webhook_event_id: 'evt_missing_sig_001',
    };

    const res = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .send(body);

    expect(res).to.have.status(401);
    expect(res.body.error).to.match(/missing webhook signature/i);
  });

  // --- Test 02: Invalid signature ---
  it('should reject webhook with invalid signature', async () => {
    const body = {
      payment_id: new mongoose.Types.ObjectId().toString(),
      status: 'completed',
      amount: 237,
      webhook_event_id: 'evt_invalid_sig_001',
    };

    const res = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678')
      .send(body);

    expect(res).to.have.status(401);
    expect(res.body.error).to.match(/invalid webhook signature/i);
  });

  // --- Test 03: Tampered body ---
  it('should reject webhook with tampered body', async () => {
    const originalBody = {
      payment_id: new mongoose.Types.ObjectId().toString(),
      status: 'completed',
      amount: 237,
      webhook_event_id: 'evt_tampered_001',
    };

    const signature = signWebhook(originalBody);

    // Tamper with the body after signing
    const tamperedBody = { ...originalBody, amount: 9999 };

    const res = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', signature)
      .send(tamperedBody);

    expect(res).to.have.status(401);
  });

  // --- Test 04: Amount does not match order total ---
  it('should reject when amount does not match order total', async () => {
    const order = await Order.create({
      user_id: user._id,
      event_id: event._id,
      quantity: 2,
      total_amount: 237,
      status: 'pending',
      payment_status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const payment = await Payment.create({
      order_id: order._id,
      user_id: user._id,
      amount: 237,
      type: 'purchase',
      status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const body = {
      payment_id: payment._id.toString(),
      status: 'completed',
      amount: 100,
      webhook_event_id: 'evt_amount_mismatch_001',
    };

    const signature = signWebhook(body);

    const res = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res).to.have.status(400);
    expect(res.body.error).to.match(/amount does not match/i);
  });

  // --- Test 05: Duplicate webhook idempotency ---
  it('should handle duplicate webhook idempotently', async () => {
    const order = await Order.create({
      user_id: user._id,
      event_id: event._id,
      quantity: 1,
      total_amount: 237,
      status: 'pending',
      payment_status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const payment = await Payment.create({
      order_id: order._id,
      user_id: user._id,
      amount: 237,
      type: 'purchase',
      status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const webhookEventId = 'evt_duplicate_001';

    const body = {
      payment_id: payment._id.toString(),
      status: 'completed',
      amount: 237,
      webhook_event_id: webhookEventId,
    };

    const signature = signWebhook(body);

    // First request
    const res1 = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res1).to.have.status(200);
    expect(res1.body.received).to.equal(true);
    expect(res1.body.payment_status).to.equal('completed');

    // Second request (duplicate)
    const res2 = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res2).to.have.status(200);
    expect(res2.body.received).to.equal(true);
    expect(res2.body.duplicate).to.equal(true);
  });

  // --- Test 06: Valid payment completion ---
  it('should process valid payment completion', async () => {
    const order = await Order.create({
      user_id: user._id,
      event_id: event._id,
      quantity: 1,
      total_amount: 237,
      status: 'pending',
      payment_status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const payment = await Payment.create({
      order_id: order._id,
      user_id: user._id,
      amount: 237,
      type: 'purchase',
      status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const body = {
      payment_id: payment._id.toString(),
      status: 'completed',
      amount: 237,
      webhook_event_id: 'evt_completion_001',
    };

    const signature = signWebhook(body);

    const res = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res).to.have.status(200);
    expect(res.body.received).to.equal(true);
    expect(res.body.payment_status).to.equal('completed');

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.status).to.equal('confirmed');
    expect(updatedOrder.payment_status).to.equal('paid');
  });

  // --- Test 07: Invalid status transition (completed -> pending) ---
  it('should ignore invalid status transition (completed -> pending)', async () => {
    const order = await Order.create({
      user_id: user._id,
      event_id: event._id,
      quantity: 1,
      total_amount: 237,
      status: 'confirmed',
      payment_status: 'paid',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const payment = await Payment.create({
      order_id: order._id,
      user_id: user._id,
      amount: 237,
      type: 'purchase',
      status: 'completed',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const body = {
      payment_id: payment._id.toString(),
      status: 'pending',
      amount: 237,
      webhook_event_id: 'evt_invalid_transition_001',
    };

    const signature = signWebhook(body);

    const res = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res).to.have.status(200);
    expect(res.body.received).to.equal(true);
    expect(res.body.ignored).to.equal(true);
  });

  // --- Test 08: Confirm all held tickets on successful payment ---
  it('should confirm all held tickets on successful payment', async () => {
    const order = await Order.create({
      user_id: user._id,
      event_id: event._id,
      quantity: 3,
      total_amount: 237,
      status: 'pending',
      payment_status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    // Create 3 held tickets
    const tickets = await Promise.all(
      [1, 2, 3].map((i) =>
        Ticket.create({
          order_id: order._id,
          event_id: event._id,
          section_id: section._id,
          user_id: user._id,
          original_user_id: user._id,
          status: 'held',
          unit_price: 79,
          service_fee: 10,
          facility_fee: 5,
        })
      )
    );

    const payment = await Payment.create({
      order_id: order._id,
      user_id: user._id,
      amount: 237,
      type: 'purchase',
      status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const body = {
      payment_id: payment._id.toString(),
      status: 'completed',
      amount: 237,
      webhook_event_id: 'evt_tickets_confirm_001',
    };

    const signature = signWebhook(body);

    const res = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res).to.have.status(200);
    expect(res.body.received).to.equal(true);
    expect(res.body.payment_status).to.equal('completed');

    // Verify all 3 tickets are now confirmed
    for (const ticket of tickets) {
      const updatedTicket = await Ticket.findById(ticket._id);
      expect(updatedTicket.status).to.equal('confirmed');
    }
  });

  // --- Test 09: Update order payment_status on failed payment ---
  it('should update order payment_status on failed payment', async () => {
    const order = await Order.create({
      user_id: user._id,
      event_id: event._id,
      quantity: 1,
      total_amount: 237,
      status: 'pending',
      payment_status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const payment = await Payment.create({
      order_id: order._id,
      user_id: user._id,
      amount: 237,
      type: 'purchase',
      status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const body = {
      payment_id: payment._id.toString(),
      status: 'failed',
      amount: 237,
      webhook_event_id: 'evt_failed_001',
    };

    const signature = signWebhook(body);

    const res = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res).to.have.status(200);
    expect(res.body.received).to.equal(true);
    expect(res.body.payment_status).to.equal('failed');

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder.payment_status).to.equal('failed');
  });

  // --- Test 10: Create WebhookLog entry for each webhook ---
  it('should create WebhookLog entry for each webhook', async () => {
    const order = await Order.create({
      user_id: user._id,
      event_id: event._id,
      quantity: 1,
      total_amount: 237,
      status: 'pending',
      payment_status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const payment = await Payment.create({
      order_id: order._id,
      user_id: user._id,
      amount: 237,
      type: 'purchase',
      status: 'pending',
      idempotency_key: `idem_${Date.now()}_${Math.random()}`,
    });

    const webhookEventId = 'evt_log_entry_001';

    const body = {
      payment_id: payment._id.toString(),
      status: 'completed',
      amount: 237,
      webhook_event_id: webhookEventId,
    };

    const signature = signWebhook(body);

    const res = await request
      .execute(app)
      .post('/api/v1/payments/webhook')
      .set('x-webhook-signature', signature)
      .send(body);

    expect(res).to.have.status(200);

    const log = await WebhookLog.findOne({ webhook_event_id: webhookEventId });
    expect(log).to.not.be.null;
    expect(log.webhook_event_id).to.equal(webhookEventId);
    expect(log.payment_id).to.equal(payment._id.toString());
    expect(log.status).to.equal('completed');
  });
});
