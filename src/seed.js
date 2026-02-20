import mongoose from 'mongoose';
import { config } from './config/env.js';
import { User } from './models/User.js';
import { Venue } from './models/Venue.js';
import { Event } from './models/Event.js';
import { VenueSection } from './models/VenueSection.js';
import { PromoCode } from './models/PromoCode.js';
import { Order } from './models/Order.js';
import { Ticket } from './models/Ticket.js';
import { Payment } from './models/Payment.js';
import { WaitlistEntry } from './models/WaitlistEntry.js';

const seed = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    console.log('Connected to MongoDB');

    // Clear existing data
    await Promise.all([
      User.deleteMany({}),
      Venue.deleteMany({}),
      Event.deleteMany({}),
      VenueSection.deleteMany({}),
      PromoCode.deleteMany({}),
      Order.deleteMany({}),
      Ticket.deleteMany({}),
      Payment.deleteMany({}),
      WaitlistEntry.deleteMany({}),
    ]);
    console.log('Cleared existing data');

    // --- Users ---
    const users = await User.create([
      { name: 'Admin User', email: 'admin@ticketflow.com', password: 'password123', role: 'admin' },
      { name: 'Event Organizer', email: 'organizer@ticketflow.com', password: 'password123', role: 'organizer' },
      { name: 'Jane Customer', email: 'jane@example.com', password: 'password123', role: 'customer' },
      { name: 'Bob Customer', email: 'bob@example.com', password: 'password123', role: 'customer' },
      { name: 'Alice Customer', email: 'alice@example.com', password: 'password123', role: 'customer' },
      { name: 'Charlie Customer', email: 'charlie@example.com', password: 'password123', role: 'customer' },
    ]);
    console.log(`Seeded ${users.length} users`);

    const organizer = users.find((u) => u.role === 'organizer');
    const jane = users.find((u) => u.email === 'jane@example.com');
    const bob = users.find((u) => u.email === 'bob@example.com');
    const alice = users.find((u) => u.email === 'alice@example.com');
    const charlie = users.find((u) => u.email === 'charlie@example.com');

    // --- Venues ---
    const venues = await Venue.create([
      { name: 'Grand Arena', address: '100 Main Street', city: 'New York', total_capacity: 5000 },
      { name: 'City Theater', address: '250 Broadway Ave', city: 'Chicago', total_capacity: 1200 },
      { name: 'Open Air Stadium', address: '500 Park Road', city: 'Los Angeles', total_capacity: 20000 },
    ]);
    console.log(`Seeded ${venues.length} venues`);

    // --- Events ---
    const now = new Date();
    const inOneMonth = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const inTwoMonths = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    const inThreeMonths = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const events = await Event.create([
      {
        title: 'Rock Night Live',
        description: 'An electrifying night of rock music',
        venue_id: venues[0]._id,
        organizer_id: organizer._id,
        start_date: inOneMonth,
        end_date: new Date(inOneMonth.getTime() + 4 * 60 * 60 * 1000),
        status: 'on_sale',
        category: 'concert',
      },
      {
        title: 'Comedy Hour',
        description: 'Stand-up comedy showcase featuring top comedians',
        venue_id: venues[1]._id,
        organizer_id: organizer._id,
        start_date: inTwoMonths,
        end_date: new Date(inTwoMonths.getTime() + 2 * 60 * 60 * 1000),
        status: 'published',
        category: 'comedy',
      },
      {
        title: 'Summer Music Festival',
        description: 'Three-day outdoor music festival',
        venue_id: venues[2]._id,
        organizer_id: organizer._id,
        start_date: inThreeMonths,
        end_date: new Date(inThreeMonths.getTime() + 72 * 60 * 60 * 1000),
        status: 'draft',
        category: 'festival',
      },
      {
        title: 'Jazz Night Downtown',
        description: 'An evening of smooth jazz at the City Theater',
        venue_id: venues[1]._id,
        organizer_id: organizer._id,
        start_date: inTwoMonths,
        end_date: new Date(inTwoMonths.getTime() + 3 * 60 * 60 * 1000),
        status: 'sold_out',
        category: 'concert',
      },
    ]);
    console.log(`Seeded ${events.length} events`);

    const rockNight = events[0];
    const jazzNight = events[3];

    // --- Sections ---
    const sections = await VenueSection.create([
      // Grand Arena — Rock Night Live
      { event_id: rockNight._id, venue_id: venues[0]._id, name: 'VIP Front Row', capacity: 200, base_price: 250 },
      { event_id: rockNight._id, venue_id: venues[0]._id, name: 'General Admission', capacity: 3000, base_price: 75 },
      { event_id: rockNight._id, venue_id: venues[0]._id, name: 'Balcony', capacity: 1800, base_price: 120 },
      // City Theater — Comedy Hour
      { event_id: events[1]._id, venue_id: venues[1]._id, name: 'Orchestra', capacity: 500, base_price: 60 },
      { event_id: events[1]._id, venue_id: venues[1]._id, name: 'Mezzanine', capacity: 700, base_price: 40 },
      // Open Air Stadium — Summer Festival
      { event_id: events[2]._id, venue_id: venues[2]._id, name: 'Pit', capacity: 2000, base_price: 300 },
      { event_id: events[2]._id, venue_id: venues[2]._id, name: 'Field', capacity: 10000, base_price: 150 },
      { event_id: events[2]._id, venue_id: venues[2]._id, name: 'Stands', capacity: 8000, base_price: 80 },
      // City Theater — Jazz Night Downtown (sold out)
      { event_id: jazzNight._id, venue_id: venues[1]._id, name: 'Orchestra', capacity: 100, base_price: 60, sold_count: 100 },
      { event_id: jazzNight._id, venue_id: venues[1]._id, name: 'Mezzanine', capacity: 80, base_price: 40, sold_count: 80 },
    ]);
    console.log(`Seeded ${sections.length} sections`);

    const vipSection = sections[0];
    const gaSection = sections[1];
    const balconySection = sections[2];
    const jazzOrchestra = sections[8];

    // --- Promo Codes ---
    const promos = await PromoCode.create([
      {
        code: 'EARLYBIRD',
        discount_type: 'percentage',
        discount_value: 15,
        max_uses: 100,
        valid_from: now,
        valid_to: inOneMonth,
        min_tickets: 1,
        max_discount_amount: 50,
      },
      {
        code: 'SAVE10',
        event_id: rockNight._id,
        discount_type: 'fixed',
        discount_value: 10,
        max_uses: 500,
        valid_from: now,
        valid_to: inTwoMonths,
        min_tickets: 2,
      },
    ]);
    console.log(`Seeded ${promos.length} promo codes`);

    const earlybird = promos[0];

    // --- Orders & Tickets ---
    // Pre-generate order IDs so tickets can reference them
    const order1Id = new mongoose.Types.ObjectId();
    const order2Id = new mongoose.Types.ObjectId();
    const order3Id = new mongoose.Types.ObjectId();
    const order4Id = new mongoose.Types.ObjectId();

    // Create tickets first, then orders with ticket refs
    const tickets = await Ticket.create([
      // Order 1: Jane — 2x GA @ $75 (confirmed)
      {
        order_id: order1Id,
        event_id: rockNight._id,
        section_id: gaSection._id,
        user_id: jane._id,
        original_user_id: jane._id,
        status: 'confirmed',
        unit_price: 75.00,
        service_fee: 9.00,
        facility_fee: 3.75,
      },
      {
        order_id: order1Id,
        event_id: rockNight._id,
        section_id: gaSection._id,
        user_id: jane._id,
        original_user_id: jane._id,
        status: 'confirmed',
        unit_price: 75.00,
        service_fee: 9.00,
        facility_fee: 3.75,
      },
      // Order 2: Bob — 1x VIP @ $250 with EARLYBIRD (confirmed)
      {
        order_id: order2Id,
        event_id: rockNight._id,
        section_id: vipSection._id,
        user_id: bob._id,
        original_user_id: bob._id,
        status: 'confirmed',
        unit_price: 250.00,
        service_fee: 30.00,
        facility_fee: 12.50,
      },
      // Order 3: Alice — 3x Balcony @ $120 (held, mid-checkout)
      {
        order_id: order3Id,
        event_id: rockNight._id,
        section_id: balconySection._id,
        user_id: alice._id,
        original_user_id: alice._id,
        status: 'held',
        unit_price: 120.00,
        service_fee: 14.40,
        facility_fee: 6.00,
        hold_expires_at: new Date(now.getTime() + 15 * 60 * 1000),
      },
      {
        order_id: order3Id,
        event_id: rockNight._id,
        section_id: balconySection._id,
        user_id: alice._id,
        original_user_id: alice._id,
        status: 'held',
        unit_price: 120.00,
        service_fee: 14.40,
        facility_fee: 6.00,
        hold_expires_at: new Date(now.getTime() + 15 * 60 * 1000),
      },
      {
        order_id: order3Id,
        event_id: rockNight._id,
        section_id: balconySection._id,
        user_id: alice._id,
        original_user_id: alice._id,
        status: 'held',
        unit_price: 120.00,
        service_fee: 14.40,
        facility_fee: 6.00,
        hold_expires_at: new Date(now.getTime() + 15 * 60 * 1000),
      },
      // Order 4: Jane — 2x Jazz Orchestra @ $60 (refunded)
      {
        order_id: order4Id,
        event_id: jazzNight._id,
        section_id: jazzOrchestra._id,
        user_id: jane._id,
        original_user_id: jane._id,
        status: 'refunded',
        unit_price: 60.00,
        service_fee: 7.20,
        facility_fee: 3.00,
      },
      {
        order_id: order4Id,
        event_id: jazzNight._id,
        section_id: jazzOrchestra._id,
        user_id: jane._id,
        original_user_id: jane._id,
        status: 'refunded',
        unit_price: 60.00,
        service_fee: 7.20,
        facility_fee: 3.00,
      },
    ]);
    console.log(`Seeded ${tickets.length} tickets`);

    const orders = await Order.create([
      // Order 1: Jane — 2x GA, confirmed/paid — $178.50
      {
        _id: order1Id,
        user_id: jane._id,
        event_id: rockNight._id,
        tickets: [tickets[0]._id, tickets[1]._id],
        quantity: 2,
        subtotal: 150.00,
        service_fee_total: 18.00,
        facility_fee_total: 7.50,
        processing_fee: 3.00,
        discount_amount: 0,
        total_amount: 178.50,
        status: 'confirmed',
        payment_status: 'paid',
        idempotency_key: 'seed-order-1',
      },
      // Order 2: Bob — 1x VIP + EARLYBIRD, confirmed/paid — $258.00
      {
        _id: order2Id,
        user_id: bob._id,
        event_id: rockNight._id,
        tickets: [tickets[2]._id],
        quantity: 1,
        subtotal: 250.00,
        service_fee_total: 30.00,
        facility_fee_total: 12.50,
        processing_fee: 3.00,
        discount_amount: 37.50,
        total_amount: 258.00,
        promo_code_id: earlybird._id,
        status: 'confirmed',
        payment_status: 'paid',
        idempotency_key: 'seed-order-2',
      },
      // Order 3: Alice — 3x Balcony, pending/pending — $424.20
      {
        _id: order3Id,
        user_id: alice._id,
        event_id: rockNight._id,
        tickets: [tickets[3]._id, tickets[4]._id, tickets[5]._id],
        quantity: 3,
        subtotal: 360.00,
        service_fee_total: 43.20,
        facility_fee_total: 18.00,
        processing_fee: 3.00,
        discount_amount: 0,
        total_amount: 424.20,
        status: 'pending',
        payment_status: 'pending',
        idempotency_key: 'seed-order-3',
      },
      // Order 4: Jane — 2x Jazz Orchestra, refunded/refunded — $143.40
      {
        _id: order4Id,
        user_id: jane._id,
        event_id: jazzNight._id,
        tickets: [tickets[6]._id, tickets[7]._id],
        quantity: 2,
        subtotal: 120.00,
        service_fee_total: 14.40,
        facility_fee_total: 6.00,
        processing_fee: 3.00,
        discount_amount: 0,
        total_amount: 143.40,
        status: 'refunded',
        payment_status: 'refunded',
        idempotency_key: 'seed-order-4',
      },
    ]);
    console.log(`Seeded ${orders.length} orders`);

    // --- Payments ---
    const payments = await Payment.create([
      // Order 1: completed purchase
      {
        order_id: order1Id,
        user_id: jane._id,
        amount: 178.50,
        type: 'purchase',
        status: 'completed',
        payment_method: 'credit_card',
        idempotency_key: 'seed-payment-1',
        processed_at: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
      // Order 2: completed purchase
      {
        order_id: order2Id,
        user_id: bob._id,
        amount: 258.00,
        type: 'purchase',
        status: 'completed',
        payment_method: 'credit_card',
        idempotency_key: 'seed-payment-2',
        processed_at: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
      // Order 3: pending purchase (awaiting webhook)
      {
        order_id: order3Id,
        user_id: alice._id,
        amount: 424.20,
        type: 'purchase',
        status: 'pending',
        payment_method: 'debit_card',
        idempotency_key: 'seed-payment-3',
      },
      // Order 4: completed original purchase
      {
        order_id: order4Id,
        user_id: jane._id,
        amount: 143.40,
        type: 'purchase',
        status: 'completed',
        payment_method: 'credit_card',
        idempotency_key: 'seed-payment-4a',
        processed_at: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
      },
      // Order 4: completed refund (base price only, >7 days)
      {
        order_id: order4Id,
        user_id: jane._id,
        amount: 120.00,
        type: 'refund',
        status: 'completed',
        payment_method: 'credit_card',
        idempotency_key: 'seed-payment-4b',
        processed_at: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      },
    ]);
    console.log(`Seeded ${payments.length} payments`);

    // --- Update VenueSection Counters ---
    await Promise.all([
      VenueSection.findByIdAndUpdate(gaSection._id, { $inc: { sold_count: 2 } }),
      VenueSection.findByIdAndUpdate(vipSection._id, { $inc: { sold_count: 1 } }),
      VenueSection.findByIdAndUpdate(balconySection._id, { $inc: { held_count: 3 } }),
    ]);
    console.log('Updated section counters');

    // --- Update Promo Code Usage ---
    await PromoCode.findByIdAndUpdate(earlybird._id, { $inc: { current_uses: 1 } });
    console.log('Updated promo code usage');

    // --- Waitlist Entries ---
    const waitlistEntries = await WaitlistEntry.create([
      { event_id: jazzNight._id, user_id: charlie._id, position: 1, status: 'waiting' },
      { event_id: jazzNight._id, user_id: alice._id, position: 2, status: 'waiting' },
      { event_id: jazzNight._id, user_id: bob._id, position: 3, status: 'notified' },
    ]);
    console.log(`Seeded ${waitlistEntries.length} waitlist entries`);

    console.log('\nSeed complete!');
    console.log('\nTest credentials:');
    console.log('  Admin:     admin@ticketflow.com     / password123');
    console.log('  Organizer: organizer@ticketflow.com / password123');
    console.log('  Customer:  jane@example.com         / password123');
    console.log('  Customer:  bob@example.com          / password123');
    console.log('  Customer:  alice@example.com        / password123');
    console.log('  Customer:  charlie@example.com      / password123');
    console.log('\nSample data:');
    console.log('  4 orders (confirmed, confirmed+promo, pending hold, refunded)');
    console.log('  8 tickets across GA, VIP, Balcony, and Jazz Orchestra');
    console.log('  5 payments (3 completed purchases, 1 pending, 1 refund)');
    console.log('  3 waitlist entries on sold-out Jazz Night');
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

seed();
