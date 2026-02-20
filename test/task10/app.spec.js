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

describe('Bug 10 — Multi-Section Order with Transaction Rollback', function () {
  this.timeout(15000);

  let user, token, venue, event;

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
      name: 'Multi Order Customer',
      email: 'multi_order@test.com',
      password: 'password123',
      role: 'customer',
    });
    await user.save();
    token = generateToken(user._id);

    venue = new Venue({
      name: 'Multi Section Arena',
      address: '789 Multi St',
      city: 'Test City',
      total_capacity: 5000,
    });
    await venue.save();

    event = new Event({
      title: 'Multi Section Concert',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'on_sale',
      category: 'concert',
    });
    await event.save();
  });

  beforeEach(async () => {
    await cleanupModels([Payment, Ticket, Order, PromoCode, VenueSection]);
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

  // --- Test 01: should return 404 when event does not exist ---
  it('should return 404 when event does not exist', async () => {
    const fakeEventId = new mongoose.Types.ObjectId();

    const vipSection = new VenueSection({
      event_id: fakeEventId,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 50,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });
    await vipSection.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: fakeEventId.toString(),
        sections: [
          { section_id: vipSection._id.toString(), quantity: 2 },
        ],
      });

    expect(res).to.have.status(404);
    expect(res.body.error).to.match(/not found|not available/i);
  });

  // --- Test 02: should return 404 when event is not on sale ---
  it('should return 404 when event is not on sale', async () => {
    const draftEvent = new Event({
      title: 'Draft Event',
      venue_id: venue._id,
      organizer_id: user._id,
      start_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + 4 * 60 * 60 * 1000),
      status: 'draft',
      category: 'concert',
    });
    await draftEvent.save();

    const vipSection = new VenueSection({
      event_id: draftEvent._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 50,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });
    await vipSection.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: draftEvent._id.toString(),
        sections: [
          { section_id: vipSection._id.toString(), quantity: 2 },
        ],
      });

    expect(res).to.have.status(404);
    expect(res.body.error).to.match(/not found|not available/i);
  });

  // --- Test 03: should create multi-section order successfully ---
  it('should create multi-section order successfully', async () => {
    const vipSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 50,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });
    await vipSection.save();

    const orchestraSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 0,
      held_count: 0,
    });
    await orchestraSection.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        sections: [
          { section_id: vipSection._id.toString(), quantity: 2 },
          { section_id: orchestraSection._id.toString(), quantity: 3 },
        ],
      });

    expect(res).to.have.status(201);
    expect(res.body.order).to.exist;
    expect(res.body.order.quantity).to.equal(5);
    expect(res.body.order.tickets).to.be.an('array').with.lengthOf(5);
    expect(res.body.total_amount).to.be.a('number');

    // DB verification: order persisted correctly
    const dbOrder = await Order.findById(res.body.order._id);
    expect(dbOrder).to.not.be.null;
    expect(dbOrder.quantity).to.equal(5);
    expect(dbOrder.status).to.be.oneOf(['pending', 'confirmed']);
  });

  // --- Test 04: should rollback first section when second section fails ---
  it('should rollback first section when second section fails', async () => {
    const vipSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 50,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });
    await vipSection.save();

    const orchestraSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 98,
      held_count: 0,
    });
    await orchestraSection.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        sections: [
          { section_id: vipSection._id.toString(), quantity: 2 },
          { section_id: orchestraSection._id.toString(), quantity: 5 },
        ],
      });

    expect(res).to.have.status(400);
    expect(res.body.error).to.match(/insufficient capacity|capacity/i);

    // Verify VIP section held_count is still 0 (rolled back)
    const updatedVip = await VenueSection.findById(vipSection._id);
    expect(updatedVip.held_count).to.equal(0);

    // DB verification: no order was created
    const orderCount = await Order.countDocuments({ event_id: event._id });
    expect(orderCount).to.equal(0);
  });

  // --- Test 05: should not create orphaned tickets on failure ---
  it('should not create orphaned tickets on failure', async () => {
    const vipSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 50,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });
    await vipSection.save();

    const orchestraSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 98,
      held_count: 0,
    });
    await orchestraSection.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        sections: [
          { section_id: vipSection._id.toString(), quantity: 2 },
          { section_id: orchestraSection._id.toString(), quantity: 5 },
        ],
      });

    expect(res).to.have.status(400);

    // Verify no orphaned tickets exist
    const ticketCount = await Ticket.countDocuments({ event_id: event._id });
    expect(ticketCount).to.equal(0);

    // DB verification: no order was created
    const orderCount = await Order.countDocuments({ event_id: event._id });
    expect(orderCount).to.equal(0);
  });

  // --- Test 06: should not leave orphaned Redis holds on failure ---
  it('should not leave orphaned Redis holds on failure', async () => {
    const vipSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 50,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });
    await vipSection.save();

    const orchestraSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 98,
      held_count: 0,
    });
    await orchestraSection.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        sections: [
          { section_id: vipSection._id.toString(), quantity: 2 },
          { section_id: orchestraSection._id.toString(), quantity: 5 },
        ],
      });

    expect(res).to.have.status(400);

    // Verify no Redis holds remain for the VIP section
    const vipKeys = await redisClient.keys(`hold:${vipSection._id}:*`);
    expect(vipKeys).to.have.lengthOf(0);

    // Verify no Redis holds remain for the Orchestra section
    const orchestraKeys = await redisClient.keys(`hold:${orchestraSection._id}:*`);
    expect(orchestraKeys).to.have.lengthOf(0);
  });

  // --- Test 07: should correctly increment held_count for each section on success ---
  it('should correctly increment held_count for each section on success', async () => {
    const vipSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 50,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });
    await vipSection.save();

    const orchestraSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 0,
      held_count: 0,
    });
    await orchestraSection.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        sections: [
          { section_id: vipSection._id.toString(), quantity: 3 },
          { section_id: orchestraSection._id.toString(), quantity: 2 },
        ],
      });

    expect(res).to.have.status(201);

    // Verify VIP held_count incremented to 3
    const updatedVip = await VenueSection.findById(vipSection._id);
    expect(updatedVip.held_count).to.equal(3);

    // Verify Orchestra held_count incremented to 2
    const updatedOrchestra = await VenueSection.findById(orchestraSection._id);
    expect(updatedOrchestra.held_count).to.equal(2);
  });

  // --- Test 08: should not change held_count on failure ---
  it('should not change held_count on failure', async () => {
    const vipSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 50,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });
    await vipSection.save();

    const orchestraSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 98,
      held_count: 0,
    });
    await orchestraSection.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        sections: [
          { section_id: vipSection._id.toString(), quantity: 2 },
          { section_id: orchestraSection._id.toString(), quantity: 5 },
        ],
      });

    expect(res).to.have.status(400);

    // Verify both sections still have held_count=0
    const updatedVip = await VenueSection.findById(vipSection._id);
    expect(updatedVip.held_count).to.equal(0);

    const updatedOrchestra = await VenueSection.findById(orchestraSection._id);
    expect(updatedOrchestra.held_count).to.equal(0);
  });

  // --- Test 09: should create correct number of tickets on success ---
  it('should create correct number of tickets on success', async () => {
    const vipSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 50,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });
    await vipSection.save();

    const orchestraSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 0,
      held_count: 0,
    });
    await orchestraSection.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        sections: [
          { section_id: vipSection._id.toString(), quantity: 2 },
          { section_id: orchestraSection._id.toString(), quantity: 4 },
        ],
      });

    expect(res).to.have.status(201);

    // Verify total tickets created = 2 + 4 = 6
    const ticketCount = await Ticket.countDocuments({ event_id: event._id });
    expect(ticketCount).to.equal(6);
  });

  // --- Test 10: should include all tickets in the order response ---
  it('should include all tickets in the order response', async () => {
    const vipSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'VIP',
      capacity: 50,
      base_price: 200,
      sold_count: 0,
      held_count: 0,
    });
    await vipSection.save();

    const orchestraSection = new VenueSection({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Orchestra',
      capacity: 100,
      base_price: 100,
      sold_count: 0,
      held_count: 0,
    });
    await orchestraSection.save();

    const res = await request
      .execute(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        event_id: event._id.toString(),
        sections: [
          { section_id: vipSection._id.toString(), quantity: 2 },
          { section_id: orchestraSection._id.toString(), quantity: 3 },
        ],
      });

    expect(res).to.have.status(201);
    expect(res.body.order).to.exist;
    expect(res.body.order.tickets).to.be.an('array');
    // Total quantity = 2 + 3 = 5, tickets array should match
    expect(res.body.order.tickets).to.have.lengthOf(res.body.order.quantity);
    expect(res.body.order.tickets).to.have.lengthOf(5);
  });

  // --- Test 11: should handle concurrent orders without overselling (TOCTOU) ---
  it('should handle concurrent orders without overselling (TOCTOU)', async () => {
    const tightSection = await VenueSection.create({
      event_id: event._id,
      venue_id: venue._id,
      name: 'Tight',
      capacity: 5,
      base_price: 100,
      sold_count: 0,
      held_count: 0,
    });

    // Two concurrent requests each trying to order 4 tickets (4+4=8 > capacity 5)
    const [res1, res2] = await Promise.all([
      request
        .execute(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          event_id: event._id.toString(),
          sections: [{ section_id: tightSection._id.toString(), quantity: 4 }],
        }),
      request
        .execute(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          event_id: event._id.toString(),
          sections: [{ section_id: tightSection._id.toString(), quantity: 4 }],
        }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    // Exactly one should succeed (201), one should fail (400)
    expect(statuses).to.deep.equal([201, 400]);

    // Verify section was not oversold
    const updatedSection = await VenueSection.findById(tightSection._id);
    expect(updatedSection.held_count).to.be.at.most(4);

    // Verify ticket count matches held_count
    const ticketCount = await Ticket.countDocuments({ section_id: tightSection._id });
    expect(ticketCount).to.equal(updatedSection.held_count);
  });
});
