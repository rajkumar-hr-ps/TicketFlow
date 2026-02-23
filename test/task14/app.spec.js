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
import { randomPrice, roundMoney, computeTicketPrice } from '../helpers/pricing.js';

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (models = [Payment, Ticket, Order, VenueSection, Event, Venue, User]) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Feature 4 — Ticket Transfer Between Users with Validation Chain', function () {
  this.timeout(15000);

  let sender, recipient, senderToken, recipientToken, venue, event, section;
  let basePrice, unitPrice, serviceFee, facilityFee;

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

    sender = await User.create({ name: 'Sender User', email: 'sender@test.com', password: 'password123', role: 'customer' });
    recipient = await User.create({ name: 'Recipient User', email: 'recipient@test.com', password: 'password123', role: 'customer' });
    senderToken = generateToken(sender._id);
    recipientToken = generateToken(recipient._id);

    venue = await Venue.create({ name: 'Transfer Arena', address: '400 Xfer St', city: 'Test City', total_capacity: 1000 });

    event = await Event.create({
      title: 'Transfer Concert',
      venue_id: venue._id,
      organizer_id: sender._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    basePrice = randomPrice(50, 200);
    ({ unitPrice, serviceFee, facilityFee } = computeTicketPrice(basePrice, 1.0));

    section = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: basePrice,
      sold_count: 50,
      held_count: 0,
    });
  });

  beforeEach(async () => {
    await Payment.deleteMany({});
    await Ticket.deleteMany({});
    await Order.deleteMany({});
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

  const createConfirmedTicket = async (userId) => {
    const order = await Order.create({
      user_id: userId,
      event_id: event._id,
      quantity: 1,
      subtotal: unitPrice,
      service_fee_total: serviceFee,
      facility_fee_total: facilityFee,
      processing_fee: 3,
      total_amount: roundMoney(unitPrice + serviceFee + facilityFee + 3),
      status: 'confirmed',
      payment_status: 'paid',
      idempotency_key: new mongoose.Types.ObjectId().toString(),
    });

    return Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: userId,
      original_user_id: userId,
      status: 'confirmed',
      unit_price: unitPrice,
      service_fee: serviceFee,
      facility_fee: facilityFee,
    });
  };

  // --- Test 01: should return 400 when to_email is missing ---
  it('should return 400 when to_email is missing', async () => {
    const ticket = await createConfirmedTicket(sender._id);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({});

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('to_email');
  });

  // --- Test 02: should return 404 when ticket does not exist ---
  it('should return 404 when ticket does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${fakeId}/transfer`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ to_email: 'recipient@test.com' });

    expect(res).to.have.status(404);
  });

  // --- Test 03: should return 404 when user does not own the ticket ---
  it('should return 404 when user does not own the ticket', async () => {
    const ticket = await createConfirmedTicket(sender._id);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${recipientToken}`)
      .send({ to_email: 'sender@test.com' });

    expect(res).to.have.status(404);

    // Verify original ticket status is unchanged in DB
    const unchangedTicket = await Ticket.findById(ticket._id);
    expect(unchangedTicket.status).to.equal('confirmed');
  });

  // --- Test 04: should return 400 when ticket is not confirmed ---
  it('should return 400 when ticket is not confirmed', async () => {
    const order = await Order.create({
      user_id: sender._id,
      event_id: event._id,
      quantity: 1,
      subtotal: unitPrice,
      service_fee_total: serviceFee,
      facility_fee_total: facilityFee,
      processing_fee: 3,
      total_amount: roundMoney(unitPrice + serviceFee + facilityFee + 3),
      status: 'pending',
      payment_status: 'pending',
      idempotency_key: new mongoose.Types.ObjectId().toString(),
    });

    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: sender._id,
      original_user_id: sender._id,
      status: 'held',
      unit_price: unitPrice,
      service_fee: serviceFee,
      facility_fee: facilityFee,
      hold_expires_at: new Date(Date.now() + 5 * 60 * 1000),
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ to_email: 'recipient@test.com' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('confirmed');

    // Verify original ticket status is unchanged in DB
    const unchangedTicket = await Ticket.findById(ticket._id);
    expect(unchangedTicket.status).to.equal('held');
  });

  // --- Test 05: should return 400 when event has already started ---
  it('should return 400 when event has already started', async () => {
    const pastEvent = await Event.create({
      title: 'Past Event',
      venue_id: venue._id,
      organizer_id: sender._id,
      start_date: new Date(Date.now() - 1 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 3 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const pastSection = await VenueSection.create({
      event_id: pastEvent._id,
      venue_id: venue._id,
      name: 'Past Section',
      capacity: 100,
      base_price: 50,
      sold_count: 10,
      held_count: 0,
    });

    const order = await Order.create({
      user_id: sender._id,
      event_id: pastEvent._id,
      quantity: 1,
      subtotal: 50,
      service_fee_total: 6,
      facility_fee_total: 2.5,
      processing_fee: 3,
      total_amount: 61.5,
      status: 'confirmed',
      payment_status: 'paid',
      idempotency_key: new mongoose.Types.ObjectId().toString(),
    });

    const ticket = await Ticket.create({
      order_id: order._id,
      event_id: pastEvent._id,
      section_id: pastSection._id,
      user_id: sender._id,
      original_user_id: sender._id,
      status: 'confirmed',
      unit_price: 50,
      service_fee: 6,
      facility_fee: 2.5,
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ to_email: 'recipient@test.com' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('started');

    // Verify original ticket status is unchanged in DB
    const unchangedTicket = await Ticket.findById(ticket._id);
    expect(unchangedTicket.status).to.equal('confirmed');
  });

  // --- Test 06: should return 404 when recipient email not found ---
  it('should return 404 when recipient email not found', async () => {
    const ticket = await createConfirmedTicket(sender._id);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ to_email: 'nonexistent@test.com' });

    expect(res).to.have.status(404);
    expect(res.body.error).to.include('recipient');

    // Verify original ticket status is unchanged in DB
    const unchangedTicket = await Ticket.findById(ticket._id);
    expect(unchangedTicket.status).to.equal('confirmed');
  });

  // --- Test 07: should return 400 when transferring to yourself ---
  it('should return 400 when transferring to yourself', async () => {
    const ticket = await createConfirmedTicket(sender._id);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ to_email: 'sender@test.com' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('yourself');

    // Verify original ticket status is unchanged in DB
    const unchangedTicket = await Ticket.findById(ticket._id);
    expect(unchangedTicket.status).to.equal('confirmed');
  });

  // --- Test 08: should invalidate original ticket on successful transfer ---
  it('should invalidate original ticket on successful transfer', async () => {
    const ticket = await createConfirmedTicket(sender._id);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ to_email: 'recipient@test.com' });

    expect(res).to.have.status(200);

    // Response structure validation
    expect(res.body).to.have.property('original_ticket_id');
    expect(res.body).to.have.property('new_ticket_id');
    expect(res.body).to.have.property('transferred_at');

    const updatedTicket = await Ticket.findById(ticket._id);
    expect(updatedTicket.status).to.equal('transferred');
    expect(updatedTicket.transferred_at).to.not.be.null;
  });

  // --- Test 09: should create new confirmed ticket for recipient ---
  it('should create new confirmed ticket for recipient', async () => {
    const ticket = await createConfirmedTicket(sender._id);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ to_email: 'recipient@test.com' });

    expect(res).to.have.status(200);
    expect(res.body.new_ticket_id).to.exist;

    const newTicket = await Ticket.findById(res.body.new_ticket_id);
    expect(newTicket.user_id.toString()).to.equal(recipient._id.toString());
    expect(newTicket.status).to.equal('confirmed');
    expect(newTicket.event_id.toString()).to.equal(event._id.toString());
    expect(newTicket.section_id.toString()).to.equal(section._id.toString());

    // Verify total ticket count (original transferred + new confirmed = 2)
    const totalTickets = await Ticket.countDocuments({ event_id: event._id });
    expect(totalTickets).to.equal(2);
  });

  // --- Test 10: should preserve original_user_id and pricing on transfer ---
  it('should preserve original_user_id and pricing on transfer', async () => {
    const ticket = await createConfirmedTicket(sender._id);

    const res = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket._id}/transfer`)
      .set('Authorization', `Bearer ${senderToken}`)
      .send({ to_email: 'recipient@test.com' });

    expect(res).to.have.status(200);

    const newTicket = await Ticket.findById(res.body.new_ticket_id);
    expect(newTicket.original_user_id.toString()).to.equal(sender._id.toString());
    expect(newTicket.unit_price).to.equal(unitPrice);
    expect(newTicket.service_fee).to.equal(serviceFee);
    expect(newTicket.facility_fee).to.equal(facilityFee);

    // Verify order_id is preserved from original ticket
    const originalTicket = await Ticket.findById(ticket._id);
    expect(newTicket.order_id.toString()).to.equal(originalTicket.order_id.toString());
  });
});
