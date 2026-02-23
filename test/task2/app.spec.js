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

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (
  models = [Payment, Ticket, Order, PromoCode, VenueSection, Event, Venue, User]
) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Bug 2 — Event Status State Machine', function () {
  this.timeout(15000);

  let organizer, otherUser, organizerToken, otherToken, venue;

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
      name: 'Event Organizer',
      email: 'organizer@test.com',
      password: 'password123',
      role: 'customer',
    });
    await organizer.save();
    organizerToken = generateToken(organizer._id);

    otherUser = new User({
      name: 'Other User',
      email: 'other@test.com',
      password: 'password123',
      role: 'customer',
    });
    await otherUser.save();
    otherToken = generateToken(otherUser._id);

    venue = new Venue({
      name: 'Test Arena',
      address: '123 Test St',
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

  // --- Test 01: 404 when event does not exist ---
  it('should return 404 when event does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${fakeId}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'published' });

    expect(res).to.have.status(404);
  });

  // --- Test 02: 404 when user is not the organizer ---
  it('should return 404 when user is not the organizer', async () => {
    const event = new Event({
      title: 'Organizer Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'draft',
      category: 'concert',
    });
    await event.save();

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 100,
      base_price: 50,
    });
    await section.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ status: 'published' });

    expect(res).to.have.status(404);

    // DB verification: status unchanged
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('draft');
  });

  // --- Test 03: draft -> published with sections ---
  it('should transition from draft to published when sections exist', async () => {
    const event = new Event({
      title: 'Draft Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'draft',
      category: 'concert',
    });
    await event.save();

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 100,
      base_price: 50,
    });
    await section.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'published' });

    expect(res).to.have.status(200);
    expect(res.body.event).to.have.property('status', 'published');

    // DB verification
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('published');
  });

  // --- Test 04: reject invalid transition draft -> on_sale ---
  it('should reject invalid transition from draft directly to on_sale', async () => {
    const event = new Event({
      title: 'Draft Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'draft',
      category: 'concert',
    });
    await event.save();

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 100,
      base_price: 50,
    });
    await section.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'on_sale' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('cannot transition');

    // DB verification: status unchanged
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('draft');
  });

  // --- Test 05: reject transition from completed (terminal state) ---
  it('should reject transition from completed (terminal state)', async () => {
    const event = new Event({
      title: 'Completed Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      status: 'completed',
      category: 'concert',
    });
    await event.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'on_sale' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('cannot transition');

    // DB verification: status unchanged
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('completed');
  });

  // --- Test 06: reject transition from cancelled (terminal state) ---
  it('should reject transition from cancelled (terminal state)', async () => {
    const event = new Event({
      title: 'Cancelled Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'cancelled',
      category: 'concert',
    });
    await event.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'published' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('cannot transition');

    // DB verification: status unchanged
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('cancelled');
  });

  // --- Test 07: require sections to publish ---
  it('should require sections to publish (draft to published without sections)', async () => {
    const event = new Event({
      title: 'No Sections Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'draft',
      category: 'concert',
    });
    await event.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'published' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('without sections');

    // DB verification: status unchanged
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('draft');
  });

  // --- Test 08: reject completing event before end date ---
  it('should reject completing event before end date', async () => {
    const event = new Event({
      title: 'Future Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
    await event.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'completed' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('before its end date');

    // DB verification: status unchanged
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('on_sale');
  });

  // --- Test 09: should transition from published to on_sale ---
  it('should transition from published to on_sale', async () => {
    const event = new Event({
      title: 'Published to OnSale Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'published',
      category: 'concert',
    });
    await event.save();

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 100,
      base_price: 50,
    });
    await section.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'on_sale' });

    expect(res).to.have.status(200);
    expect(res.body.event).to.have.property('status', 'on_sale');

    // DB verification
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('on_sale');
  });

  // --- Test 10: should transition from on_sale to cancelled ---
  it('should transition from on_sale to cancelled', async () => {
    const event = new Event({
      title: 'OnSale to Cancelled Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
    await event.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);
    expect(res.body.event || res.body).to.have.property('status', 'cancelled');

    // DB verification
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('cancelled');
  });

  // --- Test 11: should transition from on_sale to completed (past end_date) ---
  it('should transition from on_sale to completed (past end_date)', async () => {
    const event = new Event({
      title: 'OnSale to Completed Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
    await event.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'completed' });

    expect(res).to.have.status(200);
    expect(res.body.event || res.body).to.have.property('status', 'completed');

    // DB verification
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('completed');
  });

  // --- Test 12: should transition from published to cancelled ---
  it('should transition from published to cancelled', async () => {
    const event = new Event({
      title: 'Published to Cancelled Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'published',
      category: 'concert',
    });
    await event.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'cancelled' });

    expect(res).to.have.status(200);
    expect(res.body.event || res.body).to.have.property('status', 'cancelled');

    // DB verification
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('cancelled');
  });

  // --- Test 13: reject backward transition on_sale -> published ---
  it('should reject backward transition from on_sale to published', async () => {
    const event = new Event({
      title: 'OnSale Backward Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
    await event.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'published' });

    expect(res).to.have.status(400);
    expect(res.body.error).to.include('cannot transition');

    // DB verification: status unchanged
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('on_sale');
  });

  // --- Test 14: sold_out -> on_sale with available seats (success) ---
  it('should transition from sold_out to on_sale when seats are available', async () => {
    const event = new Event({
      title: 'SoldOut to OnSale Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'sold_out',
      category: 'concert',
    });
    await event.save();

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 100,
      base_price: 50,
      sold_count: 80,
      held_count: 0,
    });
    await section.save();

    const res = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'on_sale' });

    expect(res).to.have.status(200);
    expect(res.body.event).to.have.property('status', 'on_sale');

    // DB verification
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('on_sale');
  });

  // --- Test 15: full lifecycle draft -> published -> on_sale -> completed ---
  it('should complete full lifecycle: draft -> published -> on_sale -> completed', async () => {
    const event = new Event({
      title: 'Lifecycle Event',
      venue_id: venue._id,
      organizer_id: organizer._id,
      start_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      status: 'draft',
      category: 'concert',
    });
    await event.save();

    const section = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'General',
      capacity: 100,
      base_price: 50,
    });
    await section.save();

    // Step 1: draft -> published
    const res1 = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'published' });

    expect(res1).to.have.status(200);
    expect(res1.body.event).to.have.property('status', 'published');

    // Step 2: published -> on_sale
    const res2 = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'on_sale' });

    expect(res2).to.have.status(200);
    expect(res2.body.event).to.have.property('status', 'on_sale');

    // Step 3: on_sale -> completed (end_date is in the past)
    const res3 = await request
      .execute(app)
      .patch(`/api/v1/events/${event._id}/status`)
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({ status: 'completed' });

    expect(res3).to.have.status(200);
    expect(res3.body.event || res3.body).to.have.property('status', 'completed');

    // DB verification: final state
    const dbEvent = await Event.findById(event._id);
    expect(dbEvent.status).to.equal('completed');
  });
});
