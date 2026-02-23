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
import { WaitlistEntry } from '../../src/models/WaitlistEntry.js';

use(chaiHttp);

const generateToken = (userId) =>
  jwt.sign({ userId }, config.jwtSecret, { expiresIn: '24h' });

const cleanupModels = async (models = [WaitlistEntry, VenueSection, Event, Venue, User]) => {
  await Promise.all(models.map((Model) => Model.deleteMany({})));
};

describe('Feature 3 — Waitlist Management with Automatic Position Assignment', function () {
  this.timeout(15000);

  let user1, user2, user3, token1, token2, token3, venue, soldOutEvent;

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

    user1 = await User.create({ name: 'Wait User 1', email: 'wait1@test.com', password: 'password123', role: 'customer' });
    user2 = await User.create({ name: 'Wait User 2', email: 'wait2@test.com', password: 'password123', role: 'customer' });
    user3 = await User.create({ name: 'Wait User 3', email: 'wait3@test.com', password: 'password123', role: 'customer' });
    token1 = generateToken(user1._id);
    token2 = generateToken(user2._id);
    token3 = generateToken(user3._id);

    venue = await Venue.create({ name: 'Waitlist Arena', address: '300 Wait St', city: 'Test City', total_capacity: 1000 });

    soldOutEvent = await Event.create({
      title: 'Sold Out Show',
      venue_id: venue._id,
      organizer_id: user1._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'sold_out',
      category: 'concert',
    });
  });

  beforeEach(async () => {
    await WaitlistEntry.deleteMany({});
    // Reset the waitlist counter for this event
    await mongoose.connection.db.collection('waitlist_counters').deleteMany({});
    await Event.findByIdAndUpdate(soldOutEvent._id, { status: 'sold_out' });
  });

  after(async () => {
    await cleanupModels();
    await mongoose.connection.db.collection('waitlist_counters').deleteMany({});
    try {
      await redisClient.flushdb();
      await redisClient.quit();
    } catch {
      // ignore
    }
    await mongoose.connection.close();
  });

  // --- Test 01: should return 404 when event does not exist ---
  it('should return 404 when event does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await request
      .execute(app)
      .post(`/api/v1/events/${fakeId}/waitlist`)
      .set('Authorization', `Bearer ${token1}`);

    expect(res).to.have.status(404);
  });

  // --- Test 02: should return 400 when event is not sold out ---
  it('should return 400 when event is not sold out', async () => {
    const onSaleEvent = await Event.create({
      title: 'On Sale Event',
      venue_id: venue._id,
      organizer_id: user1._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });

    const res = await request
      .execute(app)
      .post(`/api/v1/events/${onSaleEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token1}`);

    expect(res).to.have.status(400);
    expect(res.body.error).to.match(/sold.out/i);
  });

  // --- Test 03: should return 409 for duplicate waitlist entry ---
  it('should return 409 for duplicate waitlist entry', async () => {
    await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token1}`);

    const res = await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token1}`);

    expect(res).to.have.status(409);
    expect(res.body.error).to.include('already');
  });

  // --- Test 04: should assign position 1 to first user ---
  it('should assign position 1 to first user', async () => {
    const res = await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token1}`);

    expect(res).to.have.status(201);
    expect(res.body.position).to.equal(1);
    expect(res.body.ahead).to.equal(0);

    // Response structure assertions
    expect(res.body).to.have.property('waitlist_id');
    expect(res.body).to.have.property('event_id');
    expect(res.body).to.have.property('position');
    expect(res.body).to.have.property('status', 'waiting');
    expect(res.body).to.have.property('joined_at');
    expect(res.body.event_id.toString()).to.equal(soldOutEvent._id.toString());

    // DB verification
    const entry = await WaitlistEntry.findOne({ event_id: soldOutEvent._id, user_id: user1._id });
    expect(entry).to.not.be.null;
    expect(entry.position).to.equal(1);
    expect(entry.status).to.equal('waiting');
  });

  // --- Test 05: should assign sequential positions to multiple users ---
  it('should assign sequential positions to multiple users', async () => {
    const res1 = await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token1}`);

    const res2 = await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token2}`);

    const res3 = await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token3}`);

    expect(res1.body.position).to.equal(1);
    expect(res2.body.position).to.equal(2);
    expect(res3.body.position).to.equal(3);

    // Verify ahead counts per user
    expect(res2.body.ahead).to.equal(1);
    expect(res3.body.ahead).to.equal(2);

    // DB verification: all 3 entries with correct positions
    const entries = await WaitlistEntry.find({ event_id: soldOutEvent._id }).sort({ position: 1 });
    expect(entries).to.have.lengthOf(3);
    expect(entries[0].position).to.equal(1);
    expect(entries[1].position).to.equal(2);
    expect(entries[2].position).to.equal(3);
  });

  // --- Test 06: should return correct ahead count ---
  it('should return correct ahead count', async () => {
    await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token1}`);

    await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token2}`);

    const res = await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token3}`);

    expect(res.body.position).to.equal(3);
    expect(res.body.ahead).to.equal(2);

    // DB verification: user3 entry has position 3
    const entry = await WaitlistEntry.findOne({ event_id: soldOutEvent._id, user_id: user3._id });
    expect(entry).to.not.be.null;
    expect(entry.position).to.equal(3);
  });

  // --- Test 07: should return correct total_waiting count on GET ---
  it('should return correct total_waiting count on GET', async () => {
    await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token1}`);

    await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token2}`);

    await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token3}`);

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res).to.have.status(200);
    expect(res.body.total_waiting).to.equal(3);
    expect(res.body.ahead).to.equal(1);
    expect(res.body.position).to.equal(2);
  });

  // --- Test 08: should not count notified users in ahead ---
  it('should not count notified users in ahead', async () => {
    await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token1}`);

    await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token2}`);

    await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token3}`);

    // Mark position 1 as notified
    await WaitlistEntry.findOneAndUpdate(
      { event_id: soldOutEvent._id, user_id: user1._id },
      { status: 'notified' }
    );

    const res = await request
      .execute(app)
      .get(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token3}`);

    expect(res).to.have.status(200);
    // User3 is position 3, but user1 at position 1 is notified, so only user2 at position 2 is ahead
    expect(res.body.ahead).to.equal(1);
  });

  // --- Test 09: should return 401 without authentication ---
  it('should return 401 without authentication', async () => {
    const res = await request
      .execute(app)
      .post(`/api/v1/events/${soldOutEvent._id}/waitlist`);

    expect(res).to.have.status(401);
  });

  // --- Test 10: should return 404 on GET when not on waitlist ---
  it('should return 404 on GET when not on waitlist', async () => {
    const res = await request
      .execute(app)
      .get(`/api/v1/events/${soldOutEvent._id}/waitlist`)
      .set('Authorization', `Bearer ${token1}`);

    expect(res).to.have.status(404);
    expect(res.body.error).to.include('not on waitlist');
  });
});
