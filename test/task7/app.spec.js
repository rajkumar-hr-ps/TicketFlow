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

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (
  models = [Payment, Ticket, Order, PromoCode, VenueSection, Event, Venue, User]
) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Bug 7 — Ticket Barcode Security with HMAC Signing', function () {
  this.timeout(15000);

  let alice, bob, aliceToken, bobToken;
  let venue, event, section, order;
  let ticket1, ticket2;

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
      name: 'Barcode Arena',
      address: '123 Security St',
      city: 'Test City',
      total_capacity: 5000,
    });
    await venue.save();

    event = new Event({
      title: 'Barcode Concert',
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
      name: 'VIP',
      capacity: 200,
      base_price: 79,
      sold_count: 0,
      held_count: 0,
    });
    await section.save();

    order = await Order.create({
      user_id: alice._id,
      event_id: event._id,
      quantity: 2,
      total_amount: 188,
      status: 'confirmed',
      payment_status: 'paid',
      idempotency_key: `idem_barcode_${Date.now()}_${Math.random()}`,
    });
  });

  beforeEach(async () => {
    await cleanupModels([Payment, Ticket]);

    // Re-create two confirmed tickets for each test
    ticket1 = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: alice._id,
      original_user_id: alice._id,
      status: 'confirmed',
      unit_price: 79,
      service_fee: 10,
      facility_fee: 5,
    });

    ticket2 = await Ticket.create({
      order_id: order._id,
      event_id: event._id,
      section_id: section._id,
      user_id: alice._id,
      original_user_id: alice._id,
      status: 'confirmed',
      unit_price: 79,
      service_fee: 10,
      facility_fee: 5,
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

  // --- Test 01: Reject a forged barcode with tampered payload ---
  it('should reject a forged barcode with tampered payload', async () => {
    // Generate a legitimate barcode via API
    const genRes = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket1._id}/barcode`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});

    expect(genRes).to.have.status(200);
    const legitimateBarcode = genRes.body.barcode;
    expect(legitimateBarcode).to.be.a('string');

    // Extract payload part, tamper with it, keep original signature
    const parts = legitimateBarcode.split('.');
    expect(parts).to.have.lengthOf(2);

    const payloadStr = Buffer.from(parts[0], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadStr);

    // Tamper with the ticket ID
    payload.tid = new mongoose.Types.ObjectId().toString();
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tamperedBarcode = `${tamperedPayload}.${parts[1]}`;

    // Verify the tampered barcode
    const verifyRes = await request
      .execute(app)
      .post('/api/v1/tickets/verify-barcode')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ barcode: tamperedBarcode });

    expect(verifyRes.body.valid).to.equal(false);
    expect(verifyRes.body.error).to.match(/invalid signature/i);
  });

  // --- Test 02: Reject a plain base64 ticket ID as barcode (no signature) ---
  it('should reject a plain base64 ticket ID as barcode (no signature)', async () => {
    const plainBarcode = Buffer.from(ticket1._id.toString()).toString('base64url');

    const verifyRes = await request
      .execute(app)
      .post('/api/v1/tickets/verify-barcode')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ barcode: plainBarcode });

    expect(verifyRes.body.valid).to.equal(false);
    expect(verifyRes.body.error).to.match(/invalid barcode format/i);
  });

  // --- Test 03: Reject barcode for wrong owner (ownership mismatch) ---
  it('should reject barcode for wrong owner (ownership mismatch)', async () => {
    // Generate barcode for alice's ticket
    const genRes = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket1._id}/barcode`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});

    expect(genRes).to.have.status(200);
    const barcode = genRes.body.barcode;

    // Transfer ticket to bob (change user_id in DB)
    await Ticket.findByIdAndUpdate(ticket1._id, { user_id: bob._id });

    // Verify barcode — ownership mismatch
    const verifyRes = await request
      .execute(app)
      .post('/api/v1/tickets/verify-barcode')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ barcode });

    expect(verifyRes.body.valid).to.equal(false);
    expect(verifyRes.body.error).to.match(/ownership mismatch/i);
  });

  // --- Test 04: Generate barcode containing a dot separator (two parts) ---
  it('should generate barcode containing a dot separator (two parts)', async () => {
    const genRes = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket1._id}/barcode`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});

    expect(genRes).to.have.status(200);
    const barcode = genRes.body.barcode;
    expect(barcode).to.be.a('string');

    const parts = barcode.split('.');
    expect(parts).to.have.lengthOf(2);
    expect(parts[0]).to.not.be.empty;
    expect(parts[1]).to.not.be.empty;
  });

  // --- Test 05: Generate different barcodes for different tickets ---
  it('should generate different barcodes for different tickets', async () => {
    const genRes1 = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket1._id}/barcode`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});

    expect(genRes1).to.have.status(200);

    const genRes2 = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket2._id}/barcode`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});

    expect(genRes2).to.have.status(200);

    expect(genRes1.body.barcode).to.not.equal(genRes2.body.barcode);
  });

  // --- Test 06: Verify a valid barcode successfully ---
  it('should verify a valid barcode successfully', async () => {
    const genRes = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket1._id}/barcode`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});

    expect(genRes).to.have.status(200);
    const barcode = genRes.body.barcode;

    const verifyRes = await request
      .execute(app)
      .post('/api/v1/tickets/verify-barcode')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ barcode });

    expect(verifyRes.body.valid).to.equal(true);
    expect(verifyRes.body.ticket_id).to.equal(ticket1._id.toString());
    expect(verifyRes.body).to.have.property('ticket_id');
    expect(verifyRes.body).to.have.property('event_id');
    expect(verifyRes.body).to.have.property('scan_count');

    // DB verification: scan_count and last_scanned_at
    const dbTicket = await Ticket.findById(ticket1._id);
    expect(dbTicket.scan_count).to.equal(1);
    expect(dbTicket.last_scanned_at).to.not.be.null;
    expect(dbTicket.last_scanned_at).to.be.a('date');
  });

  // --- Test 07: Detect duplicate scan and increment scan_count ---
  it('should detect duplicate scan and increment scan_count', async () => {
    const genRes = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket1._id}/barcode`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});

    expect(genRes).to.have.status(200);
    const barcode = genRes.body.barcode;

    // First verification
    const verifyRes1 = await request
      .execute(app)
      .post('/api/v1/tickets/verify-barcode')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ barcode });

    expect(verifyRes1.body.valid).to.equal(true);

    // Second verification — duplicate scan
    const verifyRes2 = await request
      .execute(app)
      .post('/api/v1/tickets/verify-barcode')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ barcode });

    expect(verifyRes2.body.scan_count).to.equal(2);
    expect(verifyRes2.body.warning).to.match(/duplicate.*scan/i);

    // DB verification: scan_count and last_scanned_at
    const dbTicket = await Ticket.findById(ticket1._id);
    expect(dbTicket.scan_count).to.equal(2);
    expect(dbTicket.last_scanned_at).to.not.be.null;
    expect(dbTicket.last_scanned_at).to.be.a('date');
    // Verify last_scanned_at is recent (within 5 seconds)
    const timeDiff = Date.now() - new Date(dbTicket.last_scanned_at).getTime();
    expect(timeDiff).to.be.below(5000);
  });

  // --- Test 08: Reject barcode for cancelled/refunded ticket ---
  it('should reject barcode for cancelled/refunded ticket', async () => {
    // Generate barcode for a confirmed ticket
    const genRes = await request
      .execute(app)
      .post(`/api/v1/tickets/${ticket1._id}/barcode`)
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({});

    expect(genRes).to.have.status(200);
    const barcode = genRes.body.barcode;

    // Change ticket status to cancelled in DB
    await Ticket.findByIdAndUpdate(ticket1._id, { status: 'cancelled' });

    // Verify barcode — ticket not confirmed
    const verifyRes = await request
      .execute(app)
      .post('/api/v1/tickets/verify-barcode')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ barcode });

    expect(verifyRes.body.valid).to.equal(false);
    expect(verifyRes.body.error).to.match(/not confirmed/i);
  });

});
