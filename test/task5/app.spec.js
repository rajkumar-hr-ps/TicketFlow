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

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (
  models = [Payment, Ticket, Order, VenueSection, Event, Venue, User]
) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Bug 5 — Ticket Transfer with Ownership Chain', function () {
  this.timeout(15000);

  let alice, bob, aliceToken, bobToken, venue, event, section, order;

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
    alice = new User({
      name: 'Alice',
      email: 'alice@test.com',
      password: 'password123',
      role: 'customer',
    });
    await alice.save();
    aliceToken = generateToken(alice._id);

    bob = new User({
      name: 'Bob',
      email: 'bob@test.com',
      password: 'password123',
      role: 'customer',
    });
    await bob.save();
    bobToken = generateToken(bob._id);

    venue = new Venue({
      name: 'Transfer Arena',
      address: '456 Transfer St',
      city: 'Test City',
      total_capacity: 1000,
    });
    await venue.save();

    event = new Event({
      title: 'Transfer Concert',
      venue_id: venue._id,
      organizer_id: alice._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
    await event.save();

    section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 0,
      held_count: 0,
    });
    await section.save();

    order = new Order({
      user_id: alice._id,
      event_id: event._id,
      quantity: 1,
      status: 'confirmed',
      payment_status: 'paid',
      idempotency_key: 'transfer-test-order-key',
    });
    await order.save();
  });

  beforeEach(async () => {
    await cleanupModels([Payment, Ticket]);
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

  // --- Test 01: Ticket does not exist ---
  it('should return 404 when ticket does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${fakeId}/transfer`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ to_email: 'bob@test.com' });

    expect(res).to.have.status(404);
  });

  // --- Test 02: User does not own the ticket ---
  it('should return 404 when user does not own the ticket', async () => {
    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: alice._id,
      original_user_id: alice._id,
      status: 'confirmed',
      unit_price: 100,
      service_fee: 12,
      facility_fee: 5,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ to_email: 'alice@test.com' });

    expect(res).to.have.status(404);
  });

  // --- Test 03: Ticket is not confirmed ---
  it('should return 400 when ticket is not confirmed', async () => {
    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: alice._id,
      original_user_id: alice._id,
      status: 'refunded',
      unit_price: 100,
      service_fee: 12,
      facility_fee: 5,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ to_email: 'bob@test.com' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('only confirmed tickets');
  });

  // --- Test 04: Event has already started ---
  it('should return 400 when event has already started', async () => {
    const pastEvent = new Event({
      title: 'Past Concert',
      venue_id: venue._id,
      organizer_id: alice._id,
      start_date: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() - 20 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
    await pastEvent.save();

    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: pastEvent._id,
      section_id: section._id,
      user_id: alice._id,
      original_user_id: alice._id,
      status: 'confirmed',
      unit_price: 100,
      service_fee: 12,
      facility_fee: 5,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ to_email: 'bob@test.com' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('have started');

    await Event.deleteOne({ _id: pastEvent._id });
  });

  // --- Test 05: Recipient email not found ---
  it('should return 404 when recipient email not found', async () => {
    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: alice._id,
      original_user_id: alice._id,
      status: 'confirmed',
      unit_price: 100,
      service_fee: 12,
      facility_fee: 5,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ to_email: 'nonexistent@test.com' });

    expect(res).to.have.status(404);
    expect(res.body.error).to.include('recipient user not found');
  });

  // --- Test 06: Cannot transfer to yourself ---
  it('should return 400 when transferring to yourself', async () => {
    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: alice._id,
      original_user_id: alice._id,
      status: 'confirmed',
      unit_price: 100,
      service_fee: 12,
      facility_fee: 5,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ to_email: 'alice@test.com' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('yourself');
  });

  // --- Test 07: Successful transfer invalidates original ticket ---
  it('should invalidate original ticket and set transferred_at on successful transfer', async () => {
    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: alice._id,
      original_user_id: alice._id,
      status: 'confirmed',
      unit_price: 100,
      service_fee: 12,
      facility_fee: 5,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ to_email: 'bob@test.com' });

    expect(res).to.have.status(200);

    const originalTicket = await Ticket.findById(ticket._id);
    expect(originalTicket.status).to.equal('transferred');
    expect(originalTicket.transferred_at).to.not.be.null;
  });

  // --- Test 08: New confirmed ticket created for recipient with same pricing ---
  it('should create new confirmed ticket for recipient with same pricing', async () => {
    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: alice._id,
      original_user_id: alice._id,
      status: 'confirmed',
      unit_price: 100,
      service_fee: 12,
      facility_fee: 5,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ to_email: 'bob@test.com' });

    expect(res).to.have.status(200);

    const newTicket = await Ticket.findById(res.body.new_ticket_id);
    expect(newTicket).to.not.be.null;
    expect(newTicket.user_id.toString()).to.equal(bob._id.toString());
    expect(newTicket.status).to.equal('confirmed');
    expect(newTicket.unit_price).to.equal(100);
    expect(newTicket.service_fee).to.equal(12);
    expect(newTicket.facility_fee).to.equal(5);
  });

  // --- Test 09: Preserve original_user_id through transfer chain ---
  it('should preserve original_user_id through transfer chain', async () => {
    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: alice._id,
      original_user_id: alice._id,
      status: 'confirmed',
      unit_price: 100,
      service_fee: 12,
      facility_fee: 5,
    });

    // Alice transfers to Bob
    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ to_email: 'bob@test.com' });

    expect(res).to.have.status(200);

    const newTicket = await Ticket.findById(res.body.new_ticket_id);
    expect(newTicket).to.not.be.null;
    // original_user_id should be Alice (the original purchaser), not Bob
    expect(newTicket.original_user_id.toString()).to.equal(alice._id.toString());
  });
});
