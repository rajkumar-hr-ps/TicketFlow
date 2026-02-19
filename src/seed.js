import mongoose from 'mongoose';
import { config } from './config/env.js';
import { User } from './models/User.js';
import { Venue } from './models/Venue.js';
import { Event } from './models/Event.js';
import { Section } from './models/Section.js';
import { PromoCode } from './models/PromoCode.js';

const seed = async () => {
  try {
    await mongoose.connect(config.mongoUri);
    console.log('Connected to MongoDB');

    // Clear existing data
    await Promise.all([
      User.deleteMany({}),
      Venue.deleteMany({}),
      Event.deleteMany({}),
      Section.deleteMany({}),
      PromoCode.deleteMany({}),
    ]);
    console.log('Cleared existing data');

    // --- Users ---
    const users = await User.create([
      { name: 'Admin User', email: 'admin@ticketflow.com', password: 'password123', role: 'admin' },
      { name: 'Event Organizer', email: 'organizer@ticketflow.com', password: 'password123', role: 'organizer' },
      { name: 'Jane Customer', email: 'jane@example.com', password: 'password123', role: 'customer' },
      { name: 'Bob Customer', email: 'bob@example.com', password: 'password123', role: 'customer' },
    ]);
    console.log(`Seeded ${users.length} users`);

    const organizer = users.find((u) => u.role === 'organizer');

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
    ]);
    console.log(`Seeded ${events.length} events`);

    // --- Sections ---
    const sections = await Section.create([
      // Grand Arena - Rock Night Live
      { event_id: events[0]._id, venue_id: venues[0]._id, name: 'VIP Front Row', capacity: 200, base_price: 250 },
      { event_id: events[0]._id, venue_id: venues[0]._id, name: 'General Admission', capacity: 3000, base_price: 75 },
      { event_id: events[0]._id, venue_id: venues[0]._id, name: 'Balcony', capacity: 1800, base_price: 120 },
      // City Theater - Comedy Hour
      { event_id: events[1]._id, venue_id: venues[1]._id, name: 'Orchestra', capacity: 500, base_price: 60 },
      { event_id: events[1]._id, venue_id: venues[1]._id, name: 'Mezzanine', capacity: 700, base_price: 40 },
      // Open Air Stadium - Summer Festival
      { event_id: events[2]._id, venue_id: venues[2]._id, name: 'Pit', capacity: 2000, base_price: 300 },
      { event_id: events[2]._id, venue_id: venues[2]._id, name: 'Field', capacity: 10000, base_price: 150 },
      { event_id: events[2]._id, venue_id: venues[2]._id, name: 'Stands', capacity: 8000, base_price: 80 },
    ]);
    console.log(`Seeded ${sections.length} sections`);

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
        event_id: events[0]._id,
        discount_type: 'fixed',
        discount_value: 10,
        max_uses: 500,
        valid_from: now,
        valid_to: inTwoMonths,
        min_tickets: 2,
      },
    ]);
    console.log(`Seeded ${promos.length} promo codes`);

    console.log('\nSeed complete!');
    console.log('\nTest credentials:');
    console.log('  Admin:     admin@ticketflow.com     / password123');
    console.log('  Organizer: organizer@ticketflow.com / password123');
    console.log('  Customer:  jane@example.com         / password123');
    console.log('  Customer:  bob@example.com          / password123');
  } catch (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
  }
};

seed();
