# TicketFlow
# TicketFlow — Event Ticketing Platform — Application Specification

**Version:** 4.0.0
**Date:** 2026-02-17
**Runtime:** Node.js (Express + MongoDB + Mongoose + Redis + Bull)
**Challenge Mode:** Mixed (Bugs + Features — pick from candidates below)
**Rules Reference:** [TASK_CREATION_RULES.md](./TASK_CREATION_RULES.md)

---

## 1. Application Overview

### 1.1 Domain

A REST API for a high-concurrency event ticketing platform that manages venues, events, seat inventory, ticket purchases, promo codes, refunds, and waitlists. Think Ticketmaster or BookMyShow — customers browse events, hold seats in real-time (5-minute expiry), complete purchases with promo codes, transfer tickets to other users, request refunds with tiered penalty fees, and join waitlists for sold-out events.

### 1.2 Core Business Flows

**Venue & Event Management:**
- Create venues with multiple sections (e.g., "Orchestra", "Balcony", "VIP Lounge")
- Each section has a fixed `capacity` and a `base_price`
- Events are scheduled at venues with date/time, supporting multi-day events
- Events have a lifecycle: `draft` → `published` → `on_sale` → `sold_out` → `completed` → `cancelled`

**Ticket Purchase Lifecycle:**
- Customer selects seats in a section → system creates a **hold** (5-minute expiry via Redis TTL)
- Customer submits payment within the hold window → order is created, tickets are confirmed
- Hold expires without payment → seats are automatically released back to inventory
- Payment is processed asynchronously via Bull job queue

**Key Distinction — Hold vs Purchase:**
- `hold_created_at`: when the seat hold was placed (Redis key created)
- `hold_expires_at`: when the hold expires (hold_created_at + 5 minutes)
- `purchased_at`: when the payment was confirmed and tickets were issued
- Seats are **unavailable** from `hold_created_at` until either `hold_expires_at` (if abandoned) or permanently (if purchased)
- Hold state is managed in Redis; purchase state is persisted in MongoDB

**Pricing Model:**
- `base_price`: per-ticket price set on the section for each event
- `dynamic_multiplier`: demand-based multiplier (1.0x to 3.0x) computed from sell-through percentage
- `service_fee`: 12% of ticket price (non-refundable)
- `facility_fee`: 5% of ticket price (refundable only on organizer cancellation)
- `processing_fee`: $3.00 flat per order (never refundable)
- Promo codes: percentage or fixed-amount discounts on base ticket price (before fees)

**Dynamic Pricing Tiers:**

| Sell-Through % | Multiplier | Label |
|---------------|------------|-------|
| 0–49% | 1.0x | Standard |
| 50–74% | 1.25x | High Demand |
| 75–89% | 1.5x | Very High Demand |
| 90–100% | 2.0x | Peak |

**Refund Policy (time-based penalties):**

| Time Before Event | Refund % of Base Price | Service Fee Refunded? |
|-------------------|----------------------|----------------------|
| > 7 days | 100% | No |
| 3–7 days | 75% | No |
| 1–3 days | 50% | No |
| < 24 hours | 0% (no refund) | No |
| Organizer cancellation | 100% + facility fee | Yes (facility fee only) |

**Async Processing:**
- Payment processing via Bull job queue (Redis-backed)
- Hold expiry cleanup via scheduled Bull jobs
- Waitlist notification via Bull job queue
- All async jobs must be idempotent

### 1.3 Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| **Runtime** | Node.js | 18.x+ |
| **Framework** | Express.js | 4.x |
| **Database** | MongoDB | 6.x+ |
| **ODM** | Mongoose | 7.x+ |
| **Cache / Locks** | Redis | 7.x+ |
| **Job Queue** | Bull | 4.x+ |
| **Authentication** | JWT (jsonwebtoken) | HS256 |
| **Password Hashing** | bcryptjs | — |
| **Testing** | Mocha + Chai + Supertest | Mocha 10.x, Chai 4.x |
| **Test Reporter** | mocha-junit-reporter | Dual output (spec + XML) |

---

## 2. Data Models (8 Entities)

### 2.1 Soft Delete Pattern (Base)

All models use a Mongoose plugin for soft deletion:

```javascript
// src/utils/softDelete.plugin.js
schema.add({ deleted_at: { type: Date, default: null } });
schema.statics.findActive = function(filter = {}) {
  return this.find({ ...filter, deleted_at: null });
};
schema.statics.findOneActive = function(filter = {}) {
  return this.findOne({ ...filter, deleted_at: null });
};
schema.statics.countActive = function(filter = {}) {
  return this.countDocuments({ ...filter, deleted_at: null });
};
```

### 2.2 User

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `_id` | ObjectId | Auto | — |
| `name` | String | Required, max 100, trim | Full name |
| `email` | String | Required, unique, lowercase | Login identifier |
| `password` | String | Required, min 6 | Bcrypt hashed |
| `role` | String | Required, enum | `customer`, `organizer`, `admin` |
| `created_at` | Date | Auto (timestamps) | — |
| `updated_at` | Date | Auto (timestamps) | — |
| `deleted_at` | Date | Default null | Soft delete |

### 2.3 Venue

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `_id` | ObjectId | Auto | — |
| `name` | String | Required, unique, max 200 | e.g., "Madison Square Garden" |
| `address` | String | Required, max 500 | Full address |
| `city` | String | Required, max 100 | City name |
| `total_capacity` | Number | Required, ≥ 1 | Sum of all section capacities |
| `created_at` | Date | Auto | — |
| `updated_at` | Date | Auto | — |
| `deleted_at` | Date | Default null | Soft delete |

### 2.4 Event

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `_id` | ObjectId | Auto | — |
| `title` | String | Required, max 300, trim | Event name |
| `description` | String | Optional, max 2000 | Event details |
| `venue_id` | ObjectId | Required, ref: Venue | Venue reference |
| `organizer_id` | ObjectId | Required, ref: User | Organizing user |
| `start_date` | Date | Required | Event start date/time |
| `end_date` | Date | Required | Event end date/time |
| `status` | String | Required, enum | `draft`, `published`, `on_sale`, `sold_out`, `completed`, `cancelled` |
| `category` | String | Required, enum | `concert`, `sports`, `theater`, `conference`, `festival`, `comedy` |
| `created_at` | Date | Auto | — |
| `updated_at` | Date | Auto | — |
| `deleted_at` | Date | Default null | Soft delete |

**Status Lifecycle:**
```
draft     ──→ published   (event details finalized)
published ──→ on_sale     (tickets available for purchase)
on_sale   ──→ sold_out    (all sections at capacity)
          ──→ completed   (event date passed)
          ──→ cancelled   (organizer cancels — triggers refunds)
sold_out  ──→ completed   (event date passed)
          ──→ on_sale     (tickets released via refund/cancellation)
```

### 2.5 Section

Sections represent distinct seating areas within a venue for a specific event.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `_id` | ObjectId | Auto | — |
| `event_id` | ObjectId | Required, ref: Event | Event reference |
| `venue_id` | ObjectId | Required, ref: Venue | Venue reference |
| `name` | String | Required, max 100 | e.g., "Orchestra", "Balcony", "VIP" |
| `capacity` | Number | Required, ≥ 1 | Total seats in section |
| `base_price` | Number | Required, > 0 | Base ticket price for section |
| `sold_count` | Number | Default 0 | Confirmed tickets sold |
| `held_count` | Number | Default 0 | Currently held (pending purchase) |
| `created_at` | Date | Auto | — |
| `updated_at` | Date | Auto | — |
| `deleted_at` | Date | Default null | Soft delete |

**Availability (computed):**
```
available = capacity - sold_count - held_count
```

### 2.6 Ticket

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `_id` | ObjectId | Auto | — |
| `order_id` | ObjectId | Required, ref: Order | Parent order |
| `event_id` | ObjectId | Required, ref: Event | Event reference |
| `section_id` | ObjectId | Required, ref: Section | Section reference |
| `user_id` | ObjectId | Required, ref: User | Current ticket holder |
| `original_user_id` | ObjectId | Required, ref: User | Original purchaser |
| `status` | String | Required, enum | `held`, `confirmed`, `used`, `cancelled`, `refunded`, `transferred` |
| `unit_price` | Number | Required | Price at time of purchase (base × multiplier) |
| `service_fee` | Number | Required | 12% of unit_price |
| `facility_fee` | Number | Required | 5% of unit_price |
| `hold_expires_at` | Date | Optional | When the hold expires |
| `transferred_at` | Date | Default null | When ticket was transferred |
| `created_at` | Date | Auto | — |
| `updated_at` | Date | Auto | — |
| `deleted_at` | Date | Default null | Soft delete |

**Status Lifecycle:**
```
held        ──→ confirmed    (payment completed)
            ──→ cancelled    (hold expired or user abandoned)
confirmed   ──→ used         (scanned at event)
            ──→ refunded     (refund processed)
            ──→ transferred  (transferred to another user — new ticket created)
```

### 2.7 Order

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `_id` | ObjectId | Auto | — |
| `user_id` | ObjectId | Required, ref: User | Purchasing user |
| `event_id` | ObjectId | Required, ref: Event | Event reference |
| `tickets` | [ObjectId] | Required, ref: Ticket | Array of ticket IDs |
| `quantity` | Number | Required, ≥ 1 | Number of tickets |
| `subtotal` | Number | Required | Sum of ticket unit prices |
| `service_fee_total` | Number | Required | Sum of service fees |
| `facility_fee_total` | Number | Required | Sum of facility fees |
| `processing_fee` | Number | Required | $3.00 flat |
| `discount_amount` | Number | Default 0 | Promo code discount |
| `total_amount` | Number | Required | subtotal + fees - discount |
| `promo_code_id` | ObjectId | Optional, ref: PromoCode | Applied promo code |
| `status` | String | Required, enum | `pending`, `confirmed`, `cancelled`, `refunded`, `partially_refunded` |
| `payment_status` | String | Required, enum | `pending`, `processing`, `paid`, `failed`, `refunded` |
| `idempotency_key` | String | Required, unique | Prevents duplicate orders |
| `created_at` | Date | Auto | — |
| `updated_at` | Date | Auto | — |
| `deleted_at` | Date | Default null | Soft delete |

### 2.8 PromoCode

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `_id` | ObjectId | Auto | — |
| `code` | String | Required, unique, uppercase | e.g., "EARLYBIRD20" |
| `event_id` | ObjectId | Optional, ref: Event | Null = global, set = event-specific |
| `discount_type` | String | Required, enum | `percentage`, `fixed` |
| `discount_value` | Number | Required, > 0 | Percentage (0-100) or fixed amount |
| `max_uses` | Number | Required, ≥ 1 | Maximum total redemptions |
| `current_uses` | Number | Default 0 | Current redemption count |
| `valid_from` | Date | Required | Start of validity |
| `valid_to` | Date | Required | End of validity |
| `min_tickets` | Number | Default 1 | Minimum tickets in order to qualify |
| `max_discount_amount` | Number | Optional | Cap on percentage discount |
| `created_at` | Date | Auto | — |
| `updated_at` | Date | Auto | — |
| `deleted_at` | Date | Default null | Soft delete |

### 2.9 Payment

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `_id` | ObjectId | Auto | — |
| `order_id` | ObjectId | Required, ref: Order | Associated order |
| `user_id` | ObjectId | Required, ref: User | Paying user |
| `amount` | Number | Required | Payment amount |
| `type` | String | Required, enum | `purchase`, `refund` |
| `status` | String | Required, enum | `pending`, `processing`, `completed`, `failed` |
| `payment_method` | String | Optional, enum | `credit_card`, `debit_card`, `wallet` |
| `idempotency_key` | String | Required, unique | Prevents duplicate processing |
| `processed_at` | Date | Default null | When payment was finalized |
| `created_at` | Date | Auto | — |
| `updated_at` | Date | Auto | — |
| `deleted_at` | Date | Default null | Soft delete |

---

## 3. API Endpoints

### 3.1 Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/auth/register` | No | Register user |
| POST | `/api/v1/auth/login` | No | Login, get JWT |
| GET | `/api/v1/users/me` | Yes | Current user profile |

### 3.2 Venues

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/venues` | No | List venues (public) |
| POST | `/api/v1/venues` | Yes | Create venue |
| GET | `/api/v1/venues/:id` | No | Get venue details (public) |

### 3.3 Events

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/events` | No | List events (public, cached in Redis, with filters + pagination) |
| POST | `/api/v1/events` | Yes | Create event with sections |
| GET | `/api/v1/events/:id` | No | Get event details with section availability (public) |
| PATCH | `/api/v1/events/:id/status` | Yes | Update event status (organizer only) |

### 3.4 Sections

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/events/:id/sections` | No | List sections with availability (public) |
| GET | `/api/v1/events/:eventId/sections/:sectionId/availability` | No | Get real-time availability for section |

### 3.5 Orders & Tickets

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/orders` | Yes | Create order (hold seats → process payment) |
| GET | `/api/v1/orders` | Yes | List current user's orders |
| GET | `/api/v1/orders/:id` | Yes | Get order details with tickets |
| POST | `/api/v1/orders/:id/refund` | Yes | Request refund (time-based penalty) |

### 3.6 Promo Codes

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/promo-codes` | Yes | Create promo code (organizer) |
| GET | `/api/v1/promo-codes/:code/validate` | Yes | Validate promo code |

### 3.7 Payments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/orders/:id/payments` | Yes | List payments for an order |

### 3.8 Feature Endpoints (stubbed for candidates)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/v1/events/:id/sections/:sectionId/seat-map` | No | Seat availability map (public) |
| GET | `/api/v1/events/schedule?start_date=...&end_date=...` | No | Event schedule with date filter and stage grouping |
| POST | `/api/v1/events/:id/waitlist` | Yes | Join waitlist for sold-out event |
| GET | `/api/v1/events/:id/waitlist` | Yes | Get waitlist position |
| POST | `/api/v1/tickets/:id/transfer` | Yes | Transfer ticket to another user |
| GET | `/api/v1/events/:id/pricing?section_id=...&quantity=...` | Yes | Dynamic pricing preview |
| POST | `/api/v1/orders/:id/refund` | Yes | Refund with tiered penalties |

### 3.9 Pricing Rules

| Rule | Formula |
|------|---------|
| **Unit price** | `base_price × dynamic_multiplier` |
| **Service fee** | `unit_price × 0.12` (per ticket) |
| **Facility fee** | `unit_price × 0.05` (per ticket) |
| **Processing fee** | `$3.00` flat per order |
| **Subtotal** | `sum(unit_price × quantity)` |
| **Promo discount** | `percentage: subtotal × (value/100)` or `fixed: min(value, subtotal)` |
| **Total** | `subtotal + service_fees + facility_fees + processing_fee - discount` |
| **Refund (>7 days)** | `100% of base ticket prices` (fees excluded) |
| **Refund (3-7 days)** | `75% of base ticket prices` |
| **Refund (1-3 days)** | `50% of base ticket prices` |
| **Refund (<24h)** | `0%` (no refund) |

---

## 4. Project Structure

```
src/
  app.js                              # Express app, middleware
  server.js                           # Server entry point
  config/
    db.js                             # MongoDB connection
    redis.js                          # Redis client
    env.js                            # Environment config
  middleware/
    auth.js                           # JWT authentication
    errorHandler.js                   # Centralized error handler
    sanitize.js                       # NoSQL injection prevention
    rateLimiter.js                    # Rate limiting middleware
  models/
    User.js
    Venue.js
    Event.js
    Section.js
    Ticket.js
    Order.js
    PromoCode.js
    Payment.js
  routes/
    auth.routes.js
    venue.routes.js
    event.routes.js
    section.routes.js
    order.routes.js
    promoCode.routes.js
    payment.routes.js
  controllers/
    auth.controller.js
    venue.controller.js
    event.controller.js
    section.controller.js
    order.controller.js
    promoCode.controller.js
    payment.controller.js
  services/
    auth.service.js
    event.service.js
    section.service.js
    order.service.js
    ticket.service.js
    promoCode.service.js
    payment.service.js
    hold.service.js                   # Redis seat hold management
    cache.service.js                  # Redis cache helper
    pricing.service.js                # Dynamic pricing engine
  jobs/
    payment.processor.js              # Bull job: process payments
    holdExpiry.processor.js           # Bull job: cleanup expired holds
    waitlistNotifier.processor.js     # Bull job: notify waitlist
    queue.js                          # Bull queue setup
  utils/
    softDelete.plugin.js
    AppError.js
    helpers.js
  features/
    seat_availability_map/
      routes.js
      controller.js                   # FEATURE stub
    event_schedule/
      routes.js
      controller.js                   # FEATURE stub
    waitlist_management/
      routes.js
      controller.js                   # FEATURE stub
    ticket_transfer/
      routes.js
      controller.js                   # FEATURE stub
    dynamic_pricing/
      routes.js
      controller.js                   # FEATURE stub
    refund_processing/
      routes.js
      controller.js                   # FEATURE stub
tests/
  bug*.test.js                        # One test file per bug task
  feat*.test.js                       # One test file per feature task
  helpers/
    setup.js                          # Test DB + Redis setup/teardown
    factory.js                        # Test data factories
config.json
package.json
```

---

## 5. Bug Candidates (10)

> **Purpose:** Review all 10 candidates and select the desired number. Each is a standalone HackerRank question (codebase-style). Each fix requires writing a **substantial chunk of code** (15-50+ lines), not a one-line operator or variable change. Bugs are diverse across pricing, state management, security, authorization, scheduling, concurrency, distributed systems, and multi-model integrity.
>
> **Research basis:** Bug designs informed by real-world event ticketing platform issues — incomplete fee calculations, invalid state transitions, insecure barcode generation, venue double-booking, webhook fraud, and cascade failures documented across StackOverflow, GitHub issues, and industry post-mortems (Ticketmaster, EventBrite, BookMyShow).
>
> **Uniqueness from rental spec:** Every bug tests a fundamentally different algorithmic pattern from the rental bugs — not just a domain rename. See the Independence sections for cross-reference.
>
> **Test structure:** Each question has **multiple test cases** (6-12) covering validation, core logic, edge cases, and response structure.

### Bug Candidate Overview

| # | Difficulty | Time | Title | Area | Fix Size | Tests |
|---|-----------|------|-------|------|----------|-------|
| 1 | Easy | ~20-30 min | Order total uses base_price × quantity — missing entire fee pipeline (dynamic pricing, service/facility fees, promo discounts) | Pricing / Multi-Component Algorithm | ~20 lines | 8 |
| 2 | Easy | ~20-30 min | Event status update accepts any value — no state machine validation or prerequisite checks | State Management / Validation | ~22 lines | 8 |
| 3 | Easy | ~20-30 min | Hold-to-purchase confirmation only updates ticket status — section counters never transitioned, Redis holds never cleaned | Data Integrity / Counter Consistency | ~20 lines | 8 |
| 4 | Medium | ~30-45 min | Refund applies flat percentage to total_amount — doesn't decompose fee components or restore section inventory | Business Logic / Fee Decomposition | ~35 lines | 10 |
| 5 | Medium | ~30-45 min | Ticket transfer only updates user_id — original ticket stays valid, no new ticket created, no validation chain | State Management / Ownership Chain | ~35 lines | 9 |
| 6 | Medium | ~30-45 min | Venue scheduling checks exact start_date match only — multi-day event overlap completely missed | Validation / Date Range Logic | ~30 lines | 9 |
| 7 | Medium | ~30-45 min | Ticket barcode is base64 of ticket ID — predictable, unsigned, no ownership binding or scan tracking | Security / Token Generation | ~30 lines | 8 |
| 8 | Hard | ~45-60 min | Payment webhook handler has no signature verification, no amount matching, and no idempotency guard | Distributed Systems / Webhook Security | ~45 lines | 10 |
| 9 | Hard | ~45-60 min | Event cancellation by organizer only sets status — doesn't cascade refunds, restore inventory, or rollback promos across all orders | Multi-Model Cascade / Bulk Processing | ~50 lines | 11 |
| 10 | Hard | ~45-60 min | Multi-section order reserves sections sequentially — partial failure leaves orphaned reservations with no rollback | Transactions / Compensating Actions | ~45 lines | 10 |

---

### Bug 1 (Easy): Order Total Uses base_price × quantity — Missing Entire Fee Pipeline

**Time:** ~20-30 min | **Area:** Pricing / Multi-Component Algorithm | **Fix Size:** ~20 lines
**Files:** `src/services/order.service.js`
**Validates:** Understanding of multi-component pricing pipelines with dynamic multipliers, tiered fees, and promotional discount application — a fundamental pattern in e-commerce and ticketing platforms

#### Description

The `calculateOrderTotal` function computes the order total as `section.base_price × quantity` — a single multiplication that completely ignores the platform's entire pricing pipeline. The correct calculation requires: (1) looking up the dynamic pricing multiplier from the section's sell-through percentage, (2) computing per-ticket service fees (12%) and facility fees (5%), (3) adding a flat $3.00 processing fee per order, and (4) applying promo code discounts to the subtotal before fees.

This is a classic "placeholder pricing" bug seen in production ticketing systems — the initial implementation was a stub that was never replaced with the full pricing engine (ref: Ticketmaster fee transparency lawsuits, EventBrite pricing calculation bugs).

#### Symptom

Customers are charged only the base ticket price with no fees. A 2-ticket order for a section priced at $100/ticket in high demand (75%+ sold, should be 1.5x multiplier) shows $200 total instead of the correct ~$379.00 (2 × $150 unit + $36 service + $15 facility + $3 processing). Revenue reporting shows massive shortfalls. Promo codes appear to have no effect on order totals.

#### Buggy Code (`services/order.service.js`)

```javascript
async function calculateOrderTotal(sectionId, quantity, promoCode) {
  const section = await Section.findOneActive({ _id: sectionId });
  if (!section) throw new AppError('section not found', 404);

  const total = section.base_price * quantity;
  return { subtotal: total, total_amount: total };
}
```

#### Solution Code

```javascript
async function calculateOrderTotal(sectionId, quantity, promoCode) {
  const section = await Section.findOneActive({ _id: sectionId });
  if (!section) throw new AppError('section not found', 404);

  // 1. Dynamic pricing multiplier from sell-through percentage
  const sellThrough = section.capacity > 0
    ? section.sold_count / section.capacity
    : 0;
  let multiplier = 1.0;
  if (sellThrough >= 0.90) multiplier = 2.0;
  else if (sellThrough >= 0.75) multiplier = 1.5;
  else if (sellThrough >= 0.50) multiplier = 1.25;

  const unitPrice = Math.round(section.base_price * multiplier * 100) / 100;

  // 2. Per-ticket fees
  const serviceFeePerTicket = Math.round(unitPrice * 0.12 * 100) / 100;
  const facilityFeePerTicket = Math.round(unitPrice * 0.05 * 100) / 100;

  // 3. Order-level aggregation
  const subtotal = Math.round(unitPrice * quantity * 100) / 100;
  const serviceFeeTotal = Math.round(serviceFeePerTicket * quantity * 100) / 100;
  const facilityFeeTotal = Math.round(facilityFeePerTicket * quantity * 100) / 100;
  const processingFee = 3.00;

  // 4. Promo code discount (applied to subtotal, before fees)
  let discountAmount = 0;
  if (promoCode) {
    if (promoCode.discount_type === 'percentage') {
      discountAmount = Math.round(subtotal * (promoCode.discount_value / 100) * 100) / 100;
      if (promoCode.max_discount_amount) {
        discountAmount = Math.min(discountAmount, promoCode.max_discount_amount);
      }
    } else {
      discountAmount = Math.min(promoCode.discount_value, subtotal);
    }
  }

  const totalAmount = Math.round(
    (subtotal + serviceFeeTotal + facilityFeeTotal + processingFee - discountAmount) * 100
  ) / 100;

  return {
    unit_price: unitPrice,
    multiplier,
    subtotal,
    service_fee_total: serviceFeeTotal,
    facility_fee_total: facilityFeeTotal,
    processing_fee: processingFee,
    discount_amount: discountAmount,
    total_amount: totalAmount
  };
}
```

#### Test Cases (8)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_section_not_found` | Order with non-existent section | Status 404, "section not found" |
| 02 | Validation | `test_validation_02_invalid_quantity` | Quantity of 0 or negative | Status 400 |
| 03 | Pricing | `test_pricing_03_base_rate_no_demand` | 10% sell-through, $100 base, 2 tickets | `total_amount == 243.00` (2×$100 + $24 svc + $10 fac + $3 proc) |
| 04 | Pricing | `test_pricing_04_high_demand_multiplier` | 80% sell-through, $100 base, 1 ticket | `unit_price == 150`, `total_amount == 178.50` |
| 05 | Pricing | `test_pricing_05_peak_demand_multiplier` | 95% sell-through, $100 base, 1 ticket | `unit_price == 200`, `total_amount == 237.00` |
| 06 | Pricing | `test_pricing_06_promo_percentage_discount` | 20% promo on $200 subtotal | `discount_amount == 40`, total reduced by $40 |
| 07 | Pricing | `test_pricing_07_promo_fixed_discount_capped` | $500 fixed promo on $200 subtotal | `discount_amount == 200` (capped at subtotal) |
| 08 | Response | `test_response_08_all_fee_components_present` | Verify response structure | `unit_price`, `multiplier`, `subtotal`, `service_fee_total`, `facility_fee_total`, `processing_fee`, `discount_amount`, `total_amount` all present |

**Key test example (test 04 — high demand pricing with full fee pipeline):**

```javascript
it('test_pricing_04_high_demand_multiplier', async () => {
  const event = await createEvent({ status: 'on_sale' });
  const section = await createSection({
    event_id: event._id, capacity: 100, base_price: 100,
    sold_count: 80, held_count: 0 // 80% sell-through → 1.5x multiplier
  });

  const res = await request(app)
    .post('/api/v1/orders')
    .send({
      event_id: event._id.toString(),
      section_id: section._id.toString(),
      quantity: 1
    })
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).to.equal(201);
  // unit_price = $100 × 1.5 = $150
  // service_fee = $150 × 0.12 = $18
  // facility_fee = $150 × 0.05 = $7.50
  // processing_fee = $3.00
  // total = $150 + $18 + $7.50 + $3.00 = $178.50
  expect(res.body.unit_price).to.equal(150);
  expect(res.body.service_fee_total).to.equal(18);
  expect(res.body.facility_fee_total).to.equal(7.5);
  expect(res.body.total_amount).to.equal(178.5);
  // Buggy code returns: total_amount = 100 (base × 1, no fees)
});
```

---

#### Independence

Only touches `calculateOrderTotal()` in `order.service.js`. Doesn't affect event status transitions (Bug 2), hold-to-purchase counters (Bug 3), refund calculations (Bug 4), ticket transfer logic (Bug 5), venue scheduling (Bug 6), barcode generation (Bug 7), webhook handling (Bug 8), cancellation cascades (Bug 9), or multi-section transactions (Bug 10).

**Uniqueness from rental spec:** Rental Bug 1 is a weekly/monthly tiered rate algorithm based on duration tiers. This bug is a multi-component fee stacking pipeline (dynamic multiplier + three fee types + promo discount) — a fundamentally different pricing pattern.

---

### Bug 2 (Easy): Event Status Update Accepts Any Value — No State Machine Validation

**Time:** ~20-30 min | **Area:** State Management / Validation | **Fix Size:** ~22 lines
**Files:** `src/services/event.service.js`
**Validates:** Ability to implement a finite state machine with transition rules, prerequisite checks, and meaningful error messages — a core pattern in workflow-driven systems

#### Description

The `updateEventStatus` function sets `event.status = newStatus` and saves immediately — it accepts any status value without checking whether the transition is valid. There is no state machine: a draft event can jump directly to `sold_out`, a `completed` event can go back to `on_sale`, and a `cancelled` event can be revived to any state. The correct implementation requires an explicit transition map defining allowed `from → to` transitions, plus prerequisite checks (e.g., an event cannot become `published` unless it has at least one section, cannot become `on_sale` unless it's `published` first).

This is a textbook state machine validation bug — the kind of error that leads to impossible states in production (ref: multiple "ghost events" bugs in EventBrite and BookMyShow where cancelled events reappeared as on-sale).

#### Symptom

Events can reach impossible states: a draft event with no sections can be set to `sold_out`, a cancelled event can be reverted to `on_sale` (allowing purchases of tickets for a cancelled event), and event lifecycle reporting shows nonsensical transitions. QA discovers events cycling between arbitrary states with no audit trail of valid transitions.

#### Buggy Code (`services/event.service.js`)

```javascript
async function updateEventStatus(eventId, newStatus, userId) {
  const event = await Event.findOneActive({ _id: eventId, organizer_id: userId });
  if (!event) throw new AppError('event not found or unauthorized', 404);

  event.status = newStatus;
  await event.save();
  return event;
}
```

#### Solution Code

```javascript
const VALID_TRANSITIONS = {
  draft: ['published'],
  published: ['on_sale', 'cancelled'],
  on_sale: ['sold_out', 'completed', 'cancelled'],
  sold_out: ['on_sale', 'completed', 'cancelled'],
  completed: [],
  cancelled: []
};

async function updateEventStatus(eventId, newStatus, userId) {
  const event = await Event.findOneActive({ _id: eventId, organizer_id: userId });
  if (!event) throw new AppError('event not found or unauthorized', 404);

  // Validate transition is allowed
  const allowedTransitions = VALID_TRANSITIONS[event.status];
  if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
    throw new AppError(
      `cannot transition from '${event.status}' to '${newStatus}'`,
      400
    );
  }

  // Prerequisite checks for specific transitions
  if (newStatus === 'published') {
    const sectionCount = await Section.countActive({ event_id: eventId });
    if (sectionCount === 0) {
      throw new AppError('cannot publish event without sections', 400);
    }
  }

  if (newStatus === 'on_sale' && event.status === 'sold_out') {
    // Verify there are actually available seats before reverting from sold_out
    const sections = await Section.findActive({ event_id: eventId });
    const hasAvailable = sections.some(s => s.capacity - s.sold_count - s.held_count > 0);
    if (!hasAvailable) {
      throw new AppError('cannot set on_sale when no seats are available', 400);
    }
  }

  if (newStatus === 'completed') {
    if (new Date(event.end_date) > new Date()) {
      throw new AppError('cannot complete event before its end date', 400);
    }
  }

  event.status = newStatus;
  await event.save();
  return event;
}
```

#### Test Cases (8)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_event_not_found` | Non-existent event ID | Status 404 |
| 02 | Validation | `test_validation_02_not_organizer` | Different user tries to update | Status 404, "unauthorized" |
| 03 | State | `test_state_03_valid_draft_to_published` | Draft → published with sections | Status 200, `status == 'published'` |
| 04 | State | `test_state_04_invalid_draft_to_on_sale` | Draft → on_sale (skipping published) | Status 400, "cannot transition" |
| 05 | State | `test_state_05_invalid_completed_to_on_sale` | Completed → on_sale (terminal state) | Status 400, "cannot transition" |
| 06 | State | `test_state_06_invalid_cancelled_to_published` | Cancelled → published (terminal state) | Status 400, "cannot transition" |
| 07 | Prereq | `test_prereq_07_publish_requires_sections` | Draft → published with 0 sections | Status 400, "without sections" |
| 08 | Prereq | `test_prereq_08_complete_requires_past_end_date` | on_sale → completed before end_date | Status 400, "before its end date" |

**Key test example (test 04 — invalid transition blocked):**

```javascript
it('test_state_04_invalid_draft_to_on_sale', async () => {
  const event = await createEvent({
    organizer_id: organizer._id, status: 'draft'
  });
  await createSection({ event_id: event._id, capacity: 100 });

  const res = await request(app)
    .patch(`/api/v1/events/${event._id}/status`)
    .send({ status: 'on_sale' })
    .set('Authorization', `Bearer ${organizerToken}`);

  // Buggy code: sets status directly → returns 200 with status 'on_sale'
  // Fixed code: rejects invalid transition draft → on_sale
  expect(res.status).to.equal(400);
  expect(res.body.error).to.include('cannot transition');

  const updated = await Event.findById(event._id);
  expect(updated.status).to.equal('draft'); // Status unchanged
});
```

---

#### Independence

Only touches `updateEventStatus()` in `event.service.js`. Doesn't affect order pricing (Bug 1), hold-to-purchase counters (Bug 3), refund calculations (Bug 4), ticket transfer (Bug 5), venue scheduling (Bug 6), barcode generation (Bug 7), webhook handling (Bug 8), cancellation cascades (Bug 9), or multi-section transactions (Bug 10).

**Uniqueness from rental spec:** No rental bug involves state machine validation. This tests a completely different pattern — finite state machine enforcement with prerequisite checks, rather than algorithmic calculations or data aggregation.

---

### Bug 3 (Easy): Hold-to-Purchase Confirmation Only Updates Ticket Status — Section Counters Never Transitioned

**Time:** ~20-30 min | **Area:** Data Integrity / Counter Consistency | **Fix Size:** ~20 lines
**Files:** `src/services/ticket.service.js`
**Validates:** Understanding of counter transitions across data stores (MongoDB + Redis) when converting a temporary hold into a permanent purchase — maintaining data consistency across multiple systems

#### Description

When a customer completes payment and a held ticket is confirmed, the `confirmTicketPurchase` function only sets `ticket.status = 'confirmed'`. It never transitions the section's `held_count` down or `sold_count` up, never cleans up the Redis hold key (leaving phantom holds that block future purchases), and never checks if the section has become sold out (which should trigger an event status change to `sold_out`).

The result: `held_count` grows monotonically (never decremented), `sold_count` stays at 0 (never incremented), the Redis hold key remains even after purchase (counting against availability for 5 minutes), and events never reach `sold_out` status even when all seats are confirmed.

#### Symptom

After purchasing tickets, the section still shows the seats as "held" rather than "sold". Availability calculations show fewer seats available than reality (held_count too high). The event never transitions to `sold_out` even when all capacity is confirmed. Redis hold keys linger after purchase, temporarily blocking new holds on already-purchased seats until TTL expires.

#### Buggy Code (`services/ticket.service.js`)

```javascript
async function confirmTicketPurchase(ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new AppError('ticket not found', 404);

  ticket.status = 'confirmed';
  await ticket.save();
  return ticket;
}
```

#### Solution Code

```javascript
async function confirmTicketPurchase(ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new AppError('ticket not found', 404);

  if (ticket.status !== 'held') {
    throw new AppError('only held tickets can be confirmed', 400);
  }

  // 1. Transition section counters: held → sold
  const section = await Section.findByIdAndUpdate(
    ticket.section_id,
    { $inc: { held_count: -1, sold_count: 1 } },
    { new: true }
  );

  // 2. Clean up Redis hold key
  const holdKey = `hold:${ticket.section_id}:${ticket._id}`;
  await redisClient.del(holdKey);

  // 3. Update ticket status
  ticket.status = 'confirmed';
  ticket.hold_expires_at = null;
  await ticket.save();

  // 4. Check if section is now sold out
  if (section && section.capacity - section.sold_count - section.held_count <= 0) {
    // Check if ALL sections for this event are sold out
    const eventSections = await Section.findActive({ event_id: ticket.event_id });
    const allSoldOut = eventSections.every(
      s => s.capacity - s.sold_count - s.held_count <= 0
    );
    if (allSoldOut) {
      await Event.findByIdAndUpdate(ticket.event_id, { status: 'sold_out' });
    }
  }

  return ticket;
}
```

#### Test Cases (8)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_ticket_not_found` | Confirm non-existent ticket | Status 404 |
| 02 | Validation | `test_validation_02_already_confirmed` | Confirm already-confirmed ticket | Status 400, "only held tickets" |
| 03 | Counter | `test_counter_03_held_count_decremented` | Confirm 1 held ticket | `section.held_count` decreased by 1 |
| 04 | Counter | `test_counter_04_sold_count_incremented` | Confirm 1 held ticket | `section.sold_count` increased by 1 |
| 05 | Redis | `test_redis_05_hold_key_removed` | Confirm ticket, check Redis | Hold key no longer exists in Redis |
| 06 | Status | `test_status_06_event_becomes_sold_out` | Last available seat confirmed | `event.status == 'sold_out'` |
| 07 | Status | `test_status_07_event_stays_on_sale` | Seats remain after confirm | `event.status == 'on_sale'` (unchanged) |
| 08 | Response | `test_response_08_ticket_fields_updated` | Check ticket after confirm | `status == 'confirmed'`, `hold_expires_at == null` |

**Key test example (test 03 & 04 — counter transition):**

```javascript
it('test_counter_03_held_count_decremented', async () => {
  const event = await createEvent({ status: 'on_sale' });
  const section = await createSection({
    event_id: event._id, capacity: 100,
    sold_count: 50, held_count: 5 // 5 held
  });
  const ticket = await createTicket({
    section_id: section._id, event_id: event._id,
    status: 'held', hold_expires_at: futureDate(5)
  });
  await redisClient.set(`hold:${section._id}:${ticket._id}`, '1', 'EX', 300);

  const res = await request(app)
    .post(`/api/v1/tickets/${ticket._id}/confirm`)
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).to.equal(200);

  const updatedSection = await Section.findById(section._id);
  expect(updatedSection.held_count).to.equal(4);  // 5 - 1 (buggy stays at 5)
  expect(updatedSection.sold_count).to.equal(51); // 50 + 1 (buggy stays at 50)

  const holdExists = await redisClient.exists(`hold:${section._id}:${ticket._id}`);
  expect(holdExists).to.equal(0); // Hold cleaned up (buggy: still exists)
});
```

---

#### Independence

Only touches `confirmTicketPurchase()` in `ticket.service.js`. Doesn't affect order pricing (Bug 1), event status transitions via API (Bug 2), refund calculations (Bug 4), ticket transfer (Bug 5), venue scheduling (Bug 6), barcode generation (Bug 7), webhook handling (Bug 8), cancellation cascades (Bug 9), or multi-section transactions (Bug 10).

**Uniqueness from rental spec:** Rental Bug 2 is about availability query aggregation (reading data). This bug is about counter transitions between states across two data stores (MongoDB counters + Redis keys) — a write-path consistency problem, not a read-path aggregation problem.

---

### Bug 4 (Medium): Refund Applies Flat Percentage to total_amount — No Fee Decomposition or Inventory Restore

**Time:** ~30-45 min | **Area:** Business Logic / Fee Decomposition | **Fix Size:** ~35 lines
**Files:** `src/services/order.service.js`
**Validates:** Understanding of multi-component financial calculations where different components have different refund policies, combined with multi-model state updates across tickets, sections, and promo codes

#### Description

The `processRefund` function applies a flat 80% refund to `order.total_amount` regardless of when the refund is requested relative to the event date. The correct implementation requires: (1) calculating a time-based penalty tier (100% if >7 days, 75% if 3-7 days, 50% if 1-3 days, 0% if <24 hours), (2) applying the penalty only to base ticket prices (service fees are never refunded, facility fees only on organizer cancellation, processing fee never refunded), (3) restoring section `sold_count` for refunded tickets, (4) updating ticket statuses to `refunded`, and (5) decrementing promo code usage if one was applied.

The buggy code refunds fees that should be non-refundable, uses a wrong penalty percentage, ignores the time-based tier system entirely, and leaves inventory and promo counters in stale states.

#### Symptom

Refunds always return 80% of the total (including fees), even for refunds requested 2 weeks before the event (which should be 100% of base price). Service fees are incorrectly refunded. Section `sold_count` never decrements, causing availability to remain artificially low after refunds. Promo codes show inflated usage counts because cancelled orders never release their promo usage.

#### Buggy Code (`services/order.service.js`)

```javascript
async function processRefund(orderId, userId) {
  const order = await Order.findOneActive({ _id: orderId, user_id: userId });
  if (!order) throw new AppError('order not found', 404);

  const refundAmount = order.total_amount * 0.80;
  order.status = 'refunded';
  order.payment_status = 'refunded';
  await order.save();

  return { refund_amount: refundAmount, order_status: order.status };
}
```

#### Solution Code

```javascript
async function processRefund(orderId, userId) {
  const order = await Order.findOneActive({ _id: orderId, user_id: userId });
  if (!order) throw new AppError('order not found', 404);

  if (!['confirmed', 'partially_refunded'].includes(order.status)) {
    throw new AppError('order is not eligible for refund', 400);
  }

  const event = await Event.findOneActive({ _id: order.event_id });
  if (!event) throw new AppError('event not found', 400);

  // 1. Determine refund tier based on time until event
  const hoursUntilEvent = (new Date(event.start_date) - new Date()) / (1000 * 60 * 60);
  const isOrganizerCancellation = event.status === 'cancelled';

  let refundPercentage, tier;
  if (isOrganizerCancellation) {
    refundPercentage = 1.0; tier = 'organizer_cancellation';
  } else if (hoursUntilEvent > 168) {
    refundPercentage = 1.0; tier = 'full_refund';
  } else if (hoursUntilEvent > 72) {
    refundPercentage = 0.75; tier = '75_percent';
  } else if (hoursUntilEvent > 24) {
    refundPercentage = 0.50; tier = '50_percent';
  } else {
    throw new AppError('refunds not available within 24 hours of event', 400);
  }

  // 2. Fee decomposition: only base ticket price is refundable with penalty
  const tickets = await Ticket.find({ order_id: orderId, status: 'confirmed', deleted_at: null });
  const baseTotal = tickets.reduce((sum, t) => sum + t.unit_price, 0);
  const penalizedBase = Math.round(baseTotal * refundPercentage * 100) / 100;
  const facilityRefund = isOrganizerCancellation
    ? Math.round(tickets.reduce((sum, t) => sum + t.facility_fee, 0) * 100) / 100
    : 0;
  // Service fees: NEVER refunded. Processing fee: NEVER refunded.
  const totalRefund = penalizedBase + facilityRefund;

  // 3. Update ticket statuses
  await Ticket.updateMany(
    { _id: { $in: tickets.map(t => t._id) } },
    { $set: { status: 'refunded' } }
  );

  // 4. Restore section sold_count
  const sectionCounts = {};
  for (const ticket of tickets) {
    const sid = ticket.section_id.toString();
    sectionCounts[sid] = (sectionCounts[sid] || 0) + 1;
  }
  for (const [sectionId, count] of Object.entries(sectionCounts)) {
    await Section.findByIdAndUpdate(sectionId, { $inc: { sold_count: -count } });
  }

  // 5. Decrement promo code usage if one was applied
  if (order.promo_code_id) {
    await PromoCode.findByIdAndUpdate(order.promo_code_id, { $inc: { current_uses: -1 } });
  }

  // 6. Create refund payment record
  await Payment.create({
    order_id: orderId, user_id: userId, amount: totalRefund,
    type: 'refund', status: 'completed',
    idempotency_key: `refund_${orderId}_${Date.now()}`
  });

  order.status = 'refunded';
  order.payment_status = 'refunded';
  await order.save();

  return {
    refund_amount: totalRefund,
    refund_tier: tier,
    refund_percentage: refundPercentage * 100,
    base_refund: penalizedBase,
    facility_fee_refund: facilityRefund,
    service_fee_refund: 0,
    processing_fee_refund: 0,
    tickets_refunded: tickets.length,
    order_status: order.status
  };
}
```

#### Test Cases (10)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_order_not_found` | Non-existent order | Status 404 |
| 02 | Validation | `test_validation_02_already_refunded` | Refund already-refunded order | Status 400, "not eligible" |
| 03 | Validation | `test_validation_03_within_24_hours` | Event in 12 hours | Status 400, "within 24 hours" |
| 04 | Tier | `test_tier_04_full_refund_over_7_days` | Event in 10 days, $200 base | `refund_amount == 200`, `service_fee_refund == 0` |
| 05 | Tier | `test_tier_05_75pct_3_to_7_days` | Event in 5 days, $200 base | `refund_amount == 150` |
| 06 | Tier | `test_tier_06_50pct_1_to_3_days` | Event in 36 hours, $200 base | `refund_amount == 100` |
| 07 | Tier | `test_tier_07_organizer_cancel_includes_facility` | Event cancelled, $200 base + $10 facility | `refund_amount == 210` (base + facility) |
| 08 | Inventory | `test_inventory_08_section_sold_count_restored` | Refund 3 tickets from section | `section.sold_count` decreased by 3 |
| 09 | Promo | `test_promo_09_usage_decremented` | Order used promo code, refund | `promo.current_uses` decreased by 1 |
| 10 | Response | `test_response_10_complete_refund_breakdown` | Check response structure | All fee decomposition fields present |

**Key test example (test 04 — full refund with fee decomposition):**

```javascript
it('test_tier_04_full_refund_over_7_days', async () => {
  const event = await createEvent({
    start_date: futureDate(10), status: 'on_sale' // 10 days out → 100% refund
  });
  const section = await createSection({
    event_id: event._id, capacity: 100, base_price: 100, sold_count: 2
  });
  const order = await createConfirmedOrder({
    event_id: event._id, user_id: user._id, quantity: 2,
    subtotal: 200, service_fee_total: 24, facility_fee_total: 10,
    processing_fee: 3, total_amount: 237
  });

  const res = await request(app)
    .post(`/api/v1/orders/${order._id}/refund`)
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).to.equal(200);
  // Only base ticket price refunded (100% tier), fees excluded
  expect(res.body.refund_amount).to.equal(200);   // NOT 237 (total) or 189.60 (80% of total)
  expect(res.body.service_fee_refund).to.equal(0); // Service fees never refunded
  expect(res.body.facility_fee_refund).to.equal(0); // Facility only on organizer cancel
  expect(res.body.refund_tier).to.equal('full_refund');

  const updatedSection = await Section.findById(section._id);
  expect(updatedSection.sold_count).to.equal(0); // 2 - 2 (buggy: stays at 2)
});
```

---

#### Independence

Only touches `processRefund()` in `order.service.js`. Doesn't affect order total calculation (Bug 1), event status transitions (Bug 2), hold-to-purchase counters (Bug 3), ticket transfer (Bug 5), venue scheduling (Bug 6), barcode generation (Bug 7), webhook handling (Bug 8), cancellation cascades (Bug 9), or multi-section transactions (Bug 10).

**Uniqueness from rental spec:** No rental bug involves fee decomposition with different refund policies per component. Rental Bug 1 is about tiered pricing by duration; this bug is about tiered refund percentages combined with multi-component fee policies — a fundamentally different calculation pattern.

---

### Bug 5 (Medium): Ticket Transfer Only Updates user_id — Original Stays Valid, No New Ticket Created

**Time:** ~30-45 min | **Area:** State Management / Ownership Chain | **Fix Size:** ~35 lines
**Files:** `src/services/ticket.service.js`
**Validates:** Implementing a complete ownership transfer chain with invalidation of the original asset, creation of a replacement asset, validation of transferability conditions, and maintenance of an audit trail

#### Description

The `transferTicket` function simply updates `ticket.user_id` to the new owner's ID. This creates a dangerous state: the original ticket object is still `confirmed` (never invalidated), no new ticket is created for the recipient (they share the same ticket record), and there's no validation chain (no check for ticket status, event timing, recipient existence, or self-transfer). Additionally, the `transferred_at` timestamp is never set, and `original_user_id` is overwritten.

The correct implementation must: validate the ticket is transferable (confirmed status, event not yet started, not already transferred), find and verify the recipient user, mark the original ticket as `transferred` with timestamp, create a brand-new ticket for the recipient preserving pricing but tracking the transfer chain, and prevent self-transfers.

#### Symptom

After a "transfer", both the original owner and the new owner hold the same ticket record. If the original owner's order is refunded, the new owner loses their ticket. The `transferred_at` field is never set, making transfer auditing impossible. Users can transfer cancelled, refunded, or already-transferred tickets. Users can transfer tickets to themselves. Events that have already started still allow transfers.

#### Buggy Code (`services/ticket.service.js`)

```javascript
async function transferTicket(ticketId, fromUserId, toEmail) {
  const ticket = await Ticket.findOneActive({ _id: ticketId });
  if (!ticket) throw new AppError('ticket not found', 404);

  const toUser = await User.findOneActive({ email: toEmail.toLowerCase() });
  ticket.user_id = toUser._id;
  await ticket.save();
  return ticket;
}
```

#### Solution Code

```javascript
async function transferTicket(ticketId, fromUserId, toEmail) {
  const ticket = await Ticket.findOneActive({ _id: ticketId, user_id: fromUserId });
  if (!ticket) throw new AppError('ticket not found or not owned by you', 404);

  // 1. Validate ticket is transferable
  if (ticket.status !== 'confirmed') {
    throw new AppError('only confirmed tickets can be transferred', 400);
  }

  // 2. Check event hasn't started
  const event = await Event.findOneActive({ _id: ticket.event_id });
  if (!event) throw new AppError('event not found', 400);
  if (new Date(event.start_date) <= new Date()) {
    throw new AppError('cannot transfer tickets for events that have started', 400);
  }

  // 3. Find and verify recipient
  if (!toEmail) throw new AppError('recipient email is required', 400);
  const toUser = await User.findOneActive({ email: toEmail.toLowerCase() });
  if (!toUser) throw new AppError('recipient user not found', 404);

  // 4. Prevent self-transfer
  if (toUser._id.toString() === fromUserId.toString()) {
    throw new AppError('cannot transfer ticket to yourself', 400);
  }

  // 5. Invalidate original ticket
  ticket.status = 'transferred';
  ticket.transferred_at = new Date();
  await ticket.save();

  // 6. Create new ticket for recipient with transfer chain
  const newTicket = await Ticket.create({
    order_id: ticket.order_id,
    event_id: ticket.event_id,
    section_id: ticket.section_id,
    user_id: toUser._id,
    original_user_id: ticket.original_user_id, // Preserve original purchaser
    status: 'confirmed',
    unit_price: ticket.unit_price,
    service_fee: ticket.service_fee,
    facility_fee: ticket.facility_fee
  });

  return {
    transfer_id: `xfer_${ticket._id}_${newTicket._id}`,
    original_ticket_id: ticket._id,
    new_ticket_id: newTicket._id,
    from_user: fromUserId,
    to_user: toUser._id,
    to_email: toEmail.toLowerCase(),
    transferred_at: ticket.transferred_at
  };
}
```

#### Test Cases (9)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_ticket_not_found` | Non-existent ticket ID | Status 404 |
| 02 | Validation | `test_validation_02_not_ticket_owner` | Transfer someone else's ticket | Status 404, "not owned" |
| 03 | Validation | `test_validation_03_ticket_not_confirmed` | Transfer a refunded ticket | Status 400, "only confirmed" |
| 04 | Validation | `test_validation_04_event_already_started` | Event started 1 hour ago | Status 400, "have started" |
| 05 | Validation | `test_validation_05_recipient_not_found` | Non-existent email | Status 404, "recipient" |
| 06 | Validation | `test_validation_06_self_transfer_blocked` | Transfer to own email | Status 400, "yourself" |
| 07 | Transfer | `test_transfer_07_original_ticket_invalidated` | Successful transfer | `original.status == 'transferred'`, `transferred_at != null` |
| 08 | Transfer | `test_transfer_08_new_ticket_created` | Successful transfer | New ticket: `user_id == recipient`, `status == 'confirmed'`, same pricing |
| 09 | Transfer | `test_transfer_09_original_user_preserved` | Transfer chain tracking | `newTicket.original_user_id == original purchaser` (not the transferor) |

**Key test example (test 07 & 08 — full transfer chain):**

```javascript
it('test_transfer_07_original_ticket_invalidated', async () => {
  const ticket = await createConfirmedTicket({
    user_id: alice._id, event_id: futureEvent._id,
    section_id: section._id, unit_price: 150, service_fee: 18, facility_fee: 7.5
  });

  const res = await request(app)
    .post(`/api/v1/tickets/${ticket._id}/transfer`)
    .send({ to_email: bob.email })
    .set('Authorization', `Bearer ${aliceToken}`);

  expect(res.status).to.equal(200);

  // Original ticket invalidated (buggy code: still 'confirmed')
  const original = await Ticket.findById(ticket._id);
  expect(original.status).to.equal('transferred');
  expect(original.transferred_at).to.not.be.null;

  // New ticket created for recipient (buggy code: no new ticket)
  const newTicket = await Ticket.findById(res.body.new_ticket_id);
  expect(newTicket).to.not.be.null;
  expect(newTicket.user_id.toString()).to.equal(bob._id.toString());
  expect(newTicket.status).to.equal('confirmed');
  expect(newTicket.unit_price).to.equal(150); // Pricing preserved
});
```

---

#### Independence

Only touches `transferTicket()` in `ticket.service.js`. Doesn't affect order pricing (Bug 1), event status transitions (Bug 2), hold-to-purchase counters (Bug 3), refund calculations (Bug 4), venue scheduling (Bug 6), barcode generation (Bug 7), webhook handling (Bug 8), cancellation cascades (Bug 9), or multi-section transactions (Bug 10).

**Uniqueness from rental spec:** No rental bug involves ownership transfer chains. This tests asset invalidation + replacement creation + transfer chain tracking — a pattern unique to resalable/transferable digital assets (tickets, NFTs, licenses).

---

### Bug 6 (Medium): Venue Scheduling Checks Exact start_date Match — Multi-Day Event Overlap Completely Missed

**Time:** ~30-45 min | **Area:** Validation / Date Range Logic | **Fix Size:** ~30 lines
**Files:** `src/services/event.service.js`
**Validates:** Ability to implement date range overlap detection — a fundamental scheduling algorithm used in calendaring, booking, and resource management systems

#### Description

The `checkVenueAvailability` function checks for venue conflicts by querying events with an exact `start_date` match: `Event.findOne({ venue_id, start_date: requestedStartDate })`. This completely misses overlapping multi-day events. A 3-day music festival (June 1-3) won't conflict with a concert scheduled for June 2 because June 2 !== June 1. The correct implementation requires range overlap detection: two events overlap if `existingStart < requestedEnd AND existingEnd > requestedStart`, plus exclusion of cancelled events and a configurable buffer period between events.

This is a textbook date overlap bug that appears in virtually every booking/scheduling system (ref: Calendly double-booking incidents, Airbnb overlapping reservation bugs, conference room scheduling system post-mortems).

#### Symptom

Multi-day events don't block venue availability correctly. A 3-day festival at Madison Square Garden (June 1-3) allows a concert to be booked at the same venue on June 2. Single-day events on the same date with overlapping times can be double-booked. Cancelled events still block venue availability.

#### Buggy Code (`services/event.service.js`)

```javascript
async function checkVenueAvailability(venueId, startDate, endDate) {
  const conflict = await Event.findOneActive({
    venue_id: venueId,
    start_date: startDate
  });

  return !conflict;
}
```

#### Solution Code

```javascript
const BUFFER_HOURS = 4; // Minimum hours between events at same venue

async function checkVenueAvailability(venueId, startDate, endDate, excludeEventId = null) {
  const requestedStart = new Date(startDate);
  const requestedEnd = new Date(endDate);

  if (requestedEnd <= requestedStart) {
    throw new AppError('end_date must be after start_date', 400);
  }

  // Add buffer period: events need BUFFER_HOURS gap between them
  const bufferedStart = new Date(requestedStart.getTime() - BUFFER_HOURS * 60 * 60 * 1000);
  const bufferedEnd = new Date(requestedEnd.getTime() + BUFFER_HOURS * 60 * 60 * 1000);

  // Range overlap: existing.start < buffered.end AND existing.end > buffered.start
  const query = {
    venue_id: venueId,
    status: { $nin: ['cancelled', 'draft'] }, // Exclude cancelled and draft events
    start_date: { $lt: bufferedEnd },
    end_date: { $gt: bufferedStart }
  };

  // Exclude the current event (for update operations)
  if (excludeEventId) {
    query._id = { $ne: excludeEventId };
  }

  const conflicts = await Event.findActive(query).select('title start_date end_date');

  if (conflicts.length > 0) {
    const conflictList = conflicts.map(c => ({
      event_id: c._id,
      title: c.title,
      start_date: c.start_date,
      end_date: c.end_date
    }));
    return {
      available: false,
      conflicts: conflictList,
      buffer_hours: BUFFER_HOURS
    };
  }

  return { available: true, conflicts: [], buffer_hours: BUFFER_HOURS };
}
```

#### Test Cases (9)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_end_before_start` | end_date before start_date | Status 400, "must be after" |
| 02 | Overlap | `test_overlap_02_multi_day_event_blocks_middle` | Festival June 1-3, concert June 2 | `available == false`, conflict found |
| 03 | Overlap | `test_overlap_03_partial_overlap_start` | Event A ends June 3, Event B starts June 2 | `available == false` |
| 04 | Overlap | `test_overlap_04_partial_overlap_end` | Event A starts June 2, Event B ends June 3 | `available == false` |
| 05 | Overlap | `test_overlap_05_enclosed_event` | Festival June 1-5, concert June 2-3 (inside) | `available == false` |
| 06 | Buffer | `test_buffer_06_too_close_after_existing` | Existing ends 6pm, new starts 8pm (2h gap < 4h buffer) | `available == false` |
| 07 | Exclusion | `test_exclusion_07_cancelled_events_ignored` | Cancelled event on same date | `available == true` |
| 08 | Exclusion | `test_exclusion_08_self_exclusion_on_update` | Update event, own dates don't conflict | `available == true` |
| 09 | No-Conflict | `test_no_conflict_09_non_overlapping_dates` | Event A: June 1-3, Event B: June 10-12 | `available == true` |

**Key test example (test 02 — multi-day overlap detection):**

```javascript
it('test_overlap_02_multi_day_event_blocks_middle', async () => {
  const venue = await createVenue({ name: 'MSG' });

  // 3-day music festival: June 1-3
  await createEvent({
    venue_id: venue._id, status: 'on_sale',
    start_date: new Date('2024-06-01T10:00:00Z'),
    end_date: new Date('2024-06-03T23:00:00Z')
  });

  // Try to book concert on June 2 (middle of festival)
  const res = await request(app)
    .post('/api/v1/events')
    .send({
      venue_id: venue._id.toString(), title: 'Concert',
      start_date: '2024-06-02T19:00:00Z',
      end_date: '2024-06-02T23:00:00Z',
      category: 'concert'
    })
    .set('Authorization', `Bearer ${organizerToken}`);

  // Buggy code: checks start_date == June 2, finds no match (festival starts June 1)
  // Fixed code: detects range overlap (June 1 < June 2 end AND June 3 > June 2 start)
  expect(res.status).to.equal(409);
  expect(res.body.error).to.include('venue not available');
  expect(res.body.conflicts).to.have.lengthOf(1);
});
```

---

#### Independence

Only touches `checkVenueAvailability()` in `event.service.js`. Doesn't affect order pricing (Bug 1), event status transitions (Bug 2), hold-to-purchase counters (Bug 3), refund calculations (Bug 4), ticket transfer (Bug 5), barcode generation (Bug 7), webhook handling (Bug 8), cancellation cascades (Bug 9), or multi-section transactions (Bug 10).

**Uniqueness from rental spec:** Rental Bug 6 is about maintenance scheduling validation (overlap detection on maintenance records). While both involve date ranges, this bug introduces buffer period logic, multi-status exclusion filters, self-exclusion for updates, and returns structured conflict details — a significantly more complex scheduling algorithm.

---

### Bug 7 (Medium): Ticket Barcode is base64 of Ticket ID — Predictable, Unsigned, No Ownership Binding

**Time:** ~30-45 min | **Area:** Security / Token Generation | **Fix Size:** ~30 lines
**Files:** `src/services/ticket.service.js`
**Validates:** Understanding of cryptographic token generation with HMAC signing, ownership binding, and scan tracking — essential for preventing ticket fraud and counterfeiting

#### Description

The `generateBarcode` function creates a ticket barcode by base64-encoding the ticket's MongoDB ObjectId: `Buffer.from(ticketId).toString('base64')`. This is trivially reversible — anyone can decode a barcode to get the ticket ID, then forge barcodes for any ticket. There's no cryptographic signature to verify authenticity, no binding to the ticket owner (so a leaked barcode works for anyone), and no scan tracking (barcodes can be used unlimited times).

The correct implementation requires: HMAC-SHA256 signing with a server secret key, binding the token to the ticket owner and event, a verification function that checks the signature and ownership, and scan count tracking to prevent barcode sharing.

#### Symptom

Barcodes are trivially forgeable — an attacker who knows ANY ticket ID can generate a valid barcode. Barcodes have no ownership binding, so screenshots shared on social media work for anyone. The same barcode can be scanned unlimited times with no detection. Venue staff have no way to verify if a barcode is authentic or forged.

#### Buggy Code (`services/ticket.service.js`)

```javascript
function generateBarcode(ticketId) {
  return Buffer.from(ticketId.toString()).toString('base64');
}

function verifyBarcode(barcode) {
  const ticketId = Buffer.from(barcode, 'base64').toString('utf8');
  return { valid: true, ticket_id: ticketId };
}
```

#### Solution Code

```javascript
const crypto = require('crypto');

const BARCODE_SECRET = process.env.BARCODE_SECRET || 'default-barcode-secret-key';

function generateBarcode(ticketId, userId, eventId) {
  const payload = {
    tid: ticketId.toString(),
    uid: userId.toString(),
    eid: eventId.toString(),
    iat: Date.now()
  };

  const payloadStr = JSON.stringify(payload);
  const payloadB64 = Buffer.from(payloadStr).toString('base64url');

  // HMAC-SHA256 signature
  const signature = crypto
    .createHmac('sha256', BARCODE_SECRET)
    .update(payloadB64)
    .digest('base64url');

  return `${payloadB64}.${signature}`;
}

async function verifyBarcode(barcode, scannerId) {
  const parts = barcode.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'invalid barcode format' };
  }

  const [payloadB64, providedSignature] = parts;

  // 1. Verify HMAC signature
  const expectedSignature = crypto
    .createHmac('sha256', BARCODE_SECRET)
    .update(payloadB64)
    .digest('base64url');

  if (!crypto.timingSafeEqual(
    Buffer.from(providedSignature),
    Buffer.from(expectedSignature)
  )) {
    return { valid: false, error: 'invalid signature' };
  }

  // 2. Decode payload
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

  // 3. Verify ticket exists and is confirmed
  const ticket = await Ticket.findById(payload.tid);
  if (!ticket || ticket.status !== 'confirmed') {
    return { valid: false, error: 'ticket not found or not confirmed' };
  }

  // 4. Verify ownership binding
  if (ticket.user_id.toString() !== payload.uid) {
    return { valid: false, error: 'barcode ownership mismatch' };
  }

  // 5. Track scan count
  ticket.scan_count = (ticket.scan_count || 0) + 1;
  ticket.last_scanned_at = new Date();
  await ticket.save();

  return {
    valid: true,
    ticket_id: payload.tid,
    user_id: payload.uid,
    event_id: payload.eid,
    scan_count: ticket.scan_count,
    warning: ticket.scan_count > 1 ? 'duplicate_scan_detected' : null
  };
}
```

#### Test Cases (8)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Security | `test_security_01_forged_barcode_rejected` | Modify payload, keep old signature | `valid == false`, "invalid signature" |
| 02 | Security | `test_security_02_base64_id_not_valid` | Submit base64(ticketId) as barcode | `valid == false`, "invalid barcode format" |
| 03 | Security | `test_security_03_ownership_mismatch` | Valid barcode, wrong user's ticket | `valid == false`, "ownership mismatch" |
| 04 | Generate | `test_generate_04_barcode_contains_signature` | Generate barcode | Contains `.` separator, two parts |
| 05 | Generate | `test_generate_05_different_tickets_different_barcodes` | Generate for 2 tickets | Barcodes are distinct |
| 06 | Verify | `test_verify_06_valid_barcode_accepted` | Generate then verify | `valid == true`, correct ticket_id |
| 07 | Scan | `test_scan_07_duplicate_scan_warning` | Scan same barcode twice | Second scan: `scan_count == 2`, `warning == 'duplicate_scan_detected'` |
| 08 | Verify | `test_verify_08_cancelled_ticket_rejected` | Verify barcode for cancelled ticket | `valid == false`, "not confirmed" |

**Key test example (test 01 — forged barcode detection):**

```javascript
it('test_security_01_forged_barcode_rejected', async () => {
  const ticket = await createConfirmedTicket({
    user_id: user._id, event_id: event._id, section_id: section._id
  });

  // Generate a legitimate barcode
  const barcode = generateBarcode(ticket._id, user._id, event._id);

  // Tamper with the payload (change ticket ID)
  const [payloadB64, signature] = barcode.split('.');
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  payload.tid = new mongoose.Types.ObjectId().toString(); // Different ticket
  const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const forgedBarcode = `${tamperedPayload}.${signature}`;

  const res = await request(app)
    .post('/api/v1/tickets/verify-barcode')
    .send({ barcode: forgedBarcode })
    .set('Authorization', `Bearer ${scannerToken}`);

  // Buggy code: decodes base64, returns valid: true for any base64 string
  // Fixed code: HMAC verification catches the tampered payload
  expect(res.status).to.equal(200);
  expect(res.body.valid).to.equal(false);
  expect(res.body.error).to.include('invalid signature');
});
```

---

#### Independence

Only touches `generateBarcode()` and `verifyBarcode()` in `ticket.service.js`. Doesn't affect order pricing (Bug 1), event status transitions (Bug 2), hold-to-purchase counters (Bug 3), refund calculations (Bug 4), ticket transfer (Bug 5), venue scheduling (Bug 6), webhook handling (Bug 8), cancellation cascades (Bug 9), or multi-section transactions (Bug 10).

**Uniqueness from rental spec:** No rental bug involves cryptographic token generation or HMAC-based authentication. This tests a completely different pattern — signing, verification, ownership binding, and scan tracking — unique to ticket/access-token security.

---

### Bug 8 (Hard): Payment Webhook Handler Has No Signature Verification, Amount Matching, or Idempotency

**Time:** ~45-60 min | **Area:** Distributed Systems / Webhook Security | **Fix Size:** ~45 lines
**Files:** `src/controllers/payment.controller.js`
**Validates:** Implementing a production-grade webhook handler with cryptographic signature verification, amount/currency matching against the source of truth, idempotency via webhook event logging, and payment status state machine enforcement — critical for payment security in distributed systems

#### Description

The `handlePaymentWebhook` function reads the payment status directly from the request body and updates the payment record without any verification. There is no HMAC signature check (allowing forged webhooks to mark payments as completed), no amount verification (a webhook claiming $1 was paid for a $500 order would be accepted), no idempotency guard (duplicate webhook deliveries process the same payment twice), and no status state machine (a completed payment can be reverted to pending).

This is the most dangerous class of bug in payment systems — an attacker can send a fake webhook to mark any order as "paid" without actually paying (ref: Stripe webhook security documentation, multiple "free ticket" exploits on under-secured ticketing platforms).

#### Symptom

An attacker can craft a POST request to the webhook endpoint claiming any payment is "completed", and the system will accept it — effectively getting tickets for free. Duplicate webhook deliveries from the payment provider cause orders to be processed twice. The payment amount in the webhook is never compared to the order total, allowing partial payment fraud.

#### Buggy Code (`controllers/payment.controller.js`)

```javascript
async function handlePaymentWebhook(req, res) {
  const { payment_id, status, amount } = req.body;

  const payment = await Payment.findById(payment_id);
  if (!payment) return res.status(404).json({ error: 'payment not found' });

  payment.status = status;
  payment.processed_at = new Date();
  await payment.save();

  if (status === 'completed') {
    await Order.findByIdAndUpdate(payment.order_id, {
      status: 'confirmed',
      payment_status: 'paid'
    });
  }

  return res.json({ received: true });
}
```

#### Solution Code

```javascript
const crypto = require('crypto');

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;

const VALID_STATUS_TRANSITIONS = {
  pending: ['processing', 'completed', 'failed'],
  processing: ['completed', 'failed'],
  completed: [],
  failed: ['processing'] // Allow retry
};

async function handlePaymentWebhook(req, res) {
  // 1. Verify webhook signature (HMAC-SHA256)
  const signature = req.headers['x-webhook-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'missing webhook signature' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (!crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  )) {
    return res.status(401).json({ error: 'invalid webhook signature' });
  }

  const { payment_id, status, amount, currency, webhook_event_id } = req.body;

  // 2. Idempotency check — prevent duplicate processing
  const existingWebhook = await WebhookLog.findOne({ webhook_event_id });
  if (existingWebhook) {
    return res.json({ received: true, duplicate: true });
  }

  // Log this webhook event
  await WebhookLog.create({
    webhook_event_id,
    payment_id,
    status,
    received_at: new Date()
  });

  // 3. Find payment and associated order
  const payment = await Payment.findById(payment_id);
  if (!payment) return res.status(404).json({ error: 'payment not found' });

  const order = await Order.findById(payment.order_id);
  if (!order) return res.status(404).json({ error: 'order not found' });

  // 4. Verify amount matches order total
  if (Math.abs(amount - order.total_amount) > 0.01) {
    await WebhookLog.findOneAndUpdate(
      { webhook_event_id },
      { $set: { error: 'amount_mismatch', expected: order.total_amount, received: amount } }
    );
    return res.status(400).json({
      error: 'payment amount does not match order total',
      expected: order.total_amount,
      received: amount
    });
  }

  // 5. Validate status transition
  const allowedTransitions = VALID_STATUS_TRANSITIONS[payment.status];
  if (!allowedTransitions || !allowedTransitions.includes(status)) {
    return res.json({
      received: true,
      ignored: true,
      reason: `cannot transition from '${payment.status}' to '${status}'`
    });
  }

  // 6. Update payment status
  payment.status = status;
  payment.processed_at = new Date();
  await payment.save();

  // 7. Trigger order fulfillment on successful payment
  if (status === 'completed') {
    order.status = 'confirmed';
    order.payment_status = 'paid';
    await order.save();

    // Confirm all held tickets
    await Ticket.updateMany(
      { order_id: order._id, status: 'held' },
      { $set: { status: 'confirmed' } }
    );
  } else if (status === 'failed') {
    order.payment_status = 'failed';
    await order.save();
  }

  return res.json({ received: true, payment_status: payment.status });
}
```

#### Test Cases (10)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Security | `test_security_01_missing_signature_rejected` | No x-webhook-signature header | Status 401, "missing webhook signature" |
| 02 | Security | `test_security_02_invalid_signature_rejected` | Wrong HMAC signature | Status 401, "invalid webhook signature" |
| 03 | Security | `test_security_03_tampered_body_rejected` | Valid sig for different body | Status 401, signature mismatch |
| 04 | Amount | `test_amount_04_mismatch_rejected` | Webhook amount $100, order total $500 | Status 400, "amount does not match" |
| 05 | Idempotency | `test_idempotency_05_duplicate_webhook_ignored` | Same webhook_event_id sent twice | Second call: `duplicate == true`, payment unchanged |
| 06 | State | `test_state_06_valid_transition_accepted` | pending → completed | Payment status updated, order confirmed |
| 07 | State | `test_state_07_invalid_transition_ignored` | completed → pending (backwards) | `ignored == true`, payment status unchanged |
| 08 | Fulfillment | `test_fulfillment_08_tickets_confirmed_on_success` | Payment completed | All held tickets → confirmed |
| 09 | Failure | `test_failure_09_failed_payment_updates_order` | Payment failed | `order.payment_status == 'failed'` |
| 10 | Response | `test_response_10_webhook_log_created` | Any valid webhook | WebhookLog entry exists with correct fields |

**Key test example (test 02 — signature verification):**

```javascript
it('test_security_02_invalid_signature_rejected', async () => {
  const order = await createPendingOrder({ total_amount: 237 });
  const payment = await createPayment({ order_id: order._id, status: 'pending' });

  const webhookBody = {
    payment_id: payment._id.toString(),
    status: 'completed',
    amount: 237,
    currency: 'USD',
    webhook_event_id: 'evt_fake_123'
  };

  // Send with a forged signature
  const res = await request(app)
    .post('/api/v1/payments/webhook')
    .send(webhookBody)
    .set('x-webhook-signature', 'deadbeef1234567890abcdef');

  // Buggy code: ignores signature, marks payment as completed → free tickets
  // Fixed code: HMAC verification rejects the forged signature
  expect(res.status).to.equal(401);
  expect(res.body.error).to.include('invalid webhook signature');

  // Verify payment was NOT updated
  const unchanged = await Payment.findById(payment._id);
  expect(unchanged.status).to.equal('pending');
});
```

---

#### Independence

Only touches `handlePaymentWebhook()` in `payment.controller.js`. Doesn't affect order pricing (Bug 1), event status transitions (Bug 2), hold-to-purchase counters (Bug 3), refund calculations (Bug 4), ticket transfer (Bug 5), venue scheduling (Bug 6), barcode generation (Bug 7), cancellation cascades (Bug 9), or multi-section transactions (Bug 10).

**Uniqueness from rental spec:** Rental Bug 9 is about payment job idempotency (Bull job retries creating duplicate charges). This bug is about webhook security at the HTTP boundary — signature verification, amount matching, and external event logging — a fundamentally different distributed systems pattern (incoming webhooks vs. outgoing job processing).

---

### Bug 9 (Hard): Event Cancellation by Organizer Only Sets Status — No Bulk Refund Cascade

**Time:** ~45-60 min | **Area:** Multi-Model Cascade / Bulk Processing | **Fix Size:** ~50 lines
**Files:** `src/services/event.service.js`
**Validates:** Implementing a multi-model cascade operation that processes bulk refunds across all orders, restores inventory, rolls back promo usage, cancels active holds, and handles partial failures — the most complex business operation in a ticketing platform

#### Description

The `cancelEvent` function sets `event.status = 'cancelled'` and returns. It doesn't process refunds for any of the existing orders, doesn't update ticket statuses, doesn't restore section inventory counts, doesn't roll back promo code usage, and doesn't clean up active Redis holds. Customers who paid for tickets receive no refund when an organizer cancels an event.

The correct implementation must: find all active orders for the event, process a full refund for each (100% of base price + facility fees, per organizer cancellation policy), update all tickets to `cancelled`, decrement section `sold_count` and `held_count`, clean up Redis holds for any held tickets, decrement promo code usage for orders that used one, create refund payment records, and handle the case where some refunds fail without blocking others.

#### Symptom

When an organizer cancels an event, the event status changes to "cancelled" but customers keep their tickets and receive no refunds. Section inventory shows seats as "sold" for a cancelled event. Promo code usage counts remain inflated. Redis hold keys linger for held-but-unpurchased tickets. Customer support is flooded with refund requests that should have been processed automatically.

#### Buggy Code (`services/event.service.js`)

```javascript
async function cancelEvent(eventId, organizerId) {
  const event = await Event.findOneActive({ _id: eventId, organizer_id: organizerId });
  if (!event) throw new AppError('event not found or unauthorized', 404);

  event.status = 'cancelled';
  await event.save();
  return event;
}
```

#### Solution Code

```javascript
async function cancelEvent(eventId, organizerId) {
  const event = await Event.findOneActive({ _id: eventId, organizer_id: organizerId });
  if (!event) throw new AppError('event not found or unauthorized', 404);

  if (['completed', 'cancelled'].includes(event.status)) {
    throw new AppError(`cannot cancel event with status '${event.status}'`, 400);
  }

  // 1. Set event status first (determines refund tier for downstream processing)
  event.status = 'cancelled';
  await event.save();

  // 2. Find all active orders for this event
  const orders = await Order.find({
    event_id: eventId,
    status: { $in: ['confirmed', 'partially_refunded'] },
    deleted_at: null
  });

  const refundResults = [];

  for (const order of orders) {
    try {
      // 2a. Get confirmed tickets for this order
      const tickets = await Ticket.find({
        order_id: order._id,
        status: 'confirmed',
        deleted_at: null
      });

      // 2b. Calculate organizer-cancellation refund (100% base + facility fees)
      const baseRefund = tickets.reduce((sum, t) => sum + t.unit_price, 0);
      const facilityRefund = tickets.reduce((sum, t) => sum + t.facility_fee, 0);
      const totalRefund = Math.round((baseRefund + facilityRefund) * 100) / 100;

      // 2c. Create refund payment record
      if (totalRefund > 0) {
        await Payment.create({
          order_id: order._id,
          user_id: order.user_id,
          amount: totalRefund,
          type: 'refund',
          status: 'completed',
          idempotency_key: `cancel_refund_${eventId}_${order._id}`
        });
      }

      // 2d. Update ticket statuses to cancelled
      await Ticket.updateMany(
        { order_id: order._id, status: 'confirmed' },
        { $set: { status: 'cancelled' } }
      );

      // 2e. Update order status
      order.status = 'refunded';
      order.payment_status = 'refunded';
      await order.save();

      // 2f. Decrement promo code usage
      if (order.promo_code_id) {
        await PromoCode.findByIdAndUpdate(
          order.promo_code_id,
          { $inc: { current_uses: -1 } }
        );
      }

      refundResults.push({
        order_id: order._id,
        refund_amount: totalRefund,
        tickets_cancelled: tickets.length,
        status: 'success'
      });
    } catch (err) {
      refundResults.push({
        order_id: order._id,
        status: 'failed',
        error: err.message
      });
    }
  }

  // 3. Cancel all held (unpurchased) tickets
  const heldTickets = await Ticket.find({
    event_id: eventId, status: 'held', deleted_at: null
  });
  for (const held of heldTickets) {
    const holdKey = `hold:${held.section_id}:${held._id}`;
    await redisClient.del(holdKey);
  }
  await Ticket.updateMany(
    { event_id: eventId, status: 'held' },
    { $set: { status: 'cancelled' } }
  );

  // 4. Reset all section counters for this event
  await Section.updateMany(
    { event_id: eventId },
    { $set: { sold_count: 0, held_count: 0 } }
  );

  return {
    event_id: eventId,
    status: 'cancelled',
    orders_processed: refundResults.length,
    refunds: refundResults,
    held_tickets_cancelled: heldTickets.length
  };
}
```

#### Test Cases (11)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_event_not_found` | Non-existent event ID | Status 404 |
| 02 | Validation | `test_validation_02_not_organizer` | Non-organizer tries to cancel | Status 404, "unauthorized" |
| 03 | Validation | `test_validation_03_already_cancelled` | Cancel already-cancelled event | Status 400, "cannot cancel" |
| 04 | Refund | `test_refund_04_all_orders_refunded` | 3 confirmed orders, cancel event | 3 refund records created |
| 05 | Refund | `test_refund_05_base_plus_facility_refunded` | $200 base + $10 facility per order | `refund_amount == 210` per order |
| 06 | Ticket | `test_ticket_06_all_tickets_cancelled` | 10 confirmed tickets across orders | All tickets: `status == 'cancelled'` |
| 07 | Inventory | `test_inventory_07_section_counters_reset` | Section had sold_count: 50 | `sold_count == 0`, `held_count == 0` |
| 08 | Promo | `test_promo_08_usage_decremented_per_order` | 2 orders used same promo | `promo.current_uses` decreased by 2 |
| 09 | Holds | `test_holds_09_redis_keys_cleaned` | 3 held tickets with Redis keys | All Redis hold keys deleted |
| 10 | Partial | `test_partial_10_continues_after_single_failure` | 3 orders, 1 fails mid-refund | 2 successful refunds, 1 failed, event still cancelled |
| 11 | Response | `test_response_11_complete_cascade_summary` | Cancel event with mixed state | Response includes orders_processed, refunds array, held_tickets_cancelled |

**Key test example (test 04 & 05 — bulk refund with fee decomposition):**

```javascript
it('test_refund_04_all_orders_refunded', async () => {
  const event = await createEvent({ status: 'on_sale', organizer_id: organizer._id });
  const section = await createSection({
    event_id: event._id, capacity: 100, base_price: 100, sold_count: 6
  });

  // Create 3 confirmed orders (2 tickets each)
  const orders = [];
  for (let i = 0; i < 3; i++) {
    orders.push(await createConfirmedOrder({
      event_id: event._id, user_id: users[i]._id, quantity: 2,
      subtotal: 200, service_fee_total: 24, facility_fee_total: 10,
      processing_fee: 3, total_amount: 237
    }));
  }

  const res = await request(app)
    .post(`/api/v1/events/${event._id}/cancel`)
    .set('Authorization', `Bearer ${organizerToken}`);

  expect(res.status).to.equal(200);
  expect(res.body.orders_processed).to.equal(3);

  // Buggy code: only sets event.status = 'cancelled', no refunds
  // Fixed code: processes full refund for each order
  for (const result of res.body.refunds) {
    expect(result.status).to.equal('success');
    // Organizer cancellation: 100% base ($200) + facility fee ($10) = $210
    expect(result.refund_amount).to.equal(210);
    expect(result.tickets_cancelled).to.equal(2);
  }

  // Verify refund payment records created
  const refundPayments = await Payment.find({ type: 'refund' });
  expect(refundPayments).to.have.lengthOf(3);

  // Verify section counters reset
  const updatedSection = await Section.findById(section._id);
  expect(updatedSection.sold_count).to.equal(0); // Buggy: stays at 6
});
```

---

#### Independence

Only touches `cancelEvent()` in `event.service.js`. Doesn't affect order pricing (Bug 1), event status transitions via API (Bug 2 — this is a different code path: organizer cancellation vs. status update endpoint), hold-to-purchase counters (Bug 3), customer-initiated refunds (Bug 4 — different trigger and refund tier), ticket transfer (Bug 5), venue scheduling (Bug 6), barcode generation (Bug 7), webhook handling (Bug 8), or multi-section transactions (Bug 10).

**Uniqueness from rental spec:** Rental Bug 10 is about rollback of a single cancelled rental across 5 models. This bug is about bulk cascade processing — iterating over ALL orders for an event, processing full refunds for each with different fee rules (organizer cancellation tier), resetting inventory, cleaning up Redis state, and handling partial failures. The scale (bulk vs. single) and the distributed state cleanup (Redis + MongoDB) make this fundamentally different.

---

### Bug 10 (Hard): Multi-Section Order Reserves Sections Sequentially — Partial Failure Leaves Orphaned Reservations

**Time:** ~45-60 min | **Area:** Transactions / Compensating Actions | **Fix Size:** ~45 lines
**Files:** `src/services/order.service.js`
**Validates:** Implementing transactional consistency across multiple reservation operations with compensating rollback on failure — a core pattern in distributed booking systems where all-or-nothing semantics are required

#### Description

The `createMultiSectionOrder` function allows customers to purchase tickets from multiple sections in a single order (e.g., 2 VIP tickets + 4 Orchestra tickets). It reserves sections sequentially in a loop: for each section, it increments `held_count`, creates tickets, and sets Redis holds. If section 3 of 4 fails (e.g., insufficient capacity), sections 1 and 2 remain reserved — their `held_count` is incremented, tickets are created with `held` status, and Redis keys are set, but the order is never completed. These orphaned reservations block seats until hold TTL expires and are never cleaned up.

The correct implementation requires: either a MongoDB transaction wrapping all operations (so they all succeed or all rollback atomically), or a compensating rollback that undoes all previous reservations on failure. Additionally, each section's availability must be verified within the transaction/lock to prevent TOCTOU races.

#### Symptom

When ordering tickets across multiple sections, if any section lacks capacity, the preceding sections show reduced availability (phantom holds). Seats are blocked for 5 minutes for an order that was never completed. Customer sees an error but some sections show fewer available seats. In high-traffic scenarios, these phantom holds cascade — multiple failed orders each leave orphaned holds, gradually reducing apparent availability across all sections.

#### Buggy Code (`services/order.service.js`)

```javascript
async function createMultiSectionOrder(userId, eventId, sectionRequests) {
  // sectionRequests: [{ section_id, quantity }, ...]
  const event = await Event.findOneActive({ _id: eventId, status: 'on_sale' });
  if (!event) throw new AppError('event not available', 404);

  const allTickets = [];

  for (const req of sectionRequests) {
    const section = await Section.findOneActive({ _id: req.section_id });
    const available = section.capacity - section.sold_count - section.held_count;
    if (available < req.quantity) {
      throw new AppError(`insufficient capacity in section ${section.name}`, 400);
    }

    section.held_count += req.quantity;
    await section.save();

    for (let i = 0; i < req.quantity; i++) {
      const ticket = await Ticket.create({
        event_id: eventId, section_id: req.section_id, user_id: userId,
        original_user_id: userId, status: 'held',
        unit_price: section.base_price,
        service_fee: section.base_price * 0.12,
        facility_fee: section.base_price * 0.05,
        hold_expires_at: new Date(Date.now() + 5 * 60 * 1000)
      });
      allTickets.push(ticket);
      await redisClient.set(`hold:${req.section_id}:${ticket._id}`, '1', 'EX', 300);
    }
  }

  const order = await Order.create({
    user_id: userId, event_id: eventId, tickets: allTickets.map(t => t._id),
    quantity: allTickets.length, status: 'pending'
  });

  return order;
}
```

#### Solution Code

```javascript
async function createMultiSectionOrder(userId, eventId, sectionRequests) {
  const event = await Event.findOneActive({ _id: eventId, status: 'on_sale' });
  if (!event) throw new AppError('event not available', 404);

  const session = await mongoose.startSession();
  const createdTickets = [];
  const redisHoldKeys = [];
  const sectionUpdates = [];

  try {
    session.startTransaction();

    for (const req of sectionRequests) {
      // Atomic check-and-reserve within transaction
      const section = await Section.findOneAndUpdate(
        {
          _id: req.section_id,
          deleted_at: null,
          $expr: {
            $gte: [
              { $subtract: ['$capacity', { $add: ['$sold_count', '$held_count'] }] },
              req.quantity
            ]
          }
        },
        { $inc: { held_count: req.quantity } },
        { new: true, session }
      );

      if (!section) {
        throw new AppError(
          `insufficient capacity in section '${req.section_id}'`,
          400
        );
      }

      sectionUpdates.push({ section_id: req.section_id, quantity: req.quantity });

      for (let i = 0; i < req.quantity; i++) {
        const ticket = await Ticket.create([{
          event_id: eventId, section_id: req.section_id, user_id: userId,
          original_user_id: userId, status: 'held',
          unit_price: section.base_price,
          service_fee: Math.round(section.base_price * 0.12 * 100) / 100,
          facility_fee: Math.round(section.base_price * 0.05 * 100) / 100,
          hold_expires_at: new Date(Date.now() + 5 * 60 * 1000)
        }], { session });

        createdTickets.push(ticket[0]);
        redisHoldKeys.push(`hold:${req.section_id}:${ticket[0]._id}`);
      }
    }

    // Create the order within the transaction
    const order = await Order.create([{
      user_id: userId, event_id: eventId,
      tickets: createdTickets.map(t => t._id),
      quantity: createdTickets.length, status: 'pending',
      idempotency_key: `order_${userId}_${eventId}_${Date.now()}`
    }], { session });

    // Commit the transaction — all MongoDB operations succeed atomically
    await session.commitTransaction();

    // Set Redis holds AFTER successful commit (outside transaction)
    for (const holdKey of redisHoldKeys) {
      await redisClient.set(holdKey, '1', 'EX', 300);
    }

    return order[0];

  } catch (error) {
    // Abort MongoDB transaction — all section updates and tickets are rolled back
    await session.abortTransaction();

    // Compensating cleanup: remove any Redis holds that were set
    // (in this implementation, holds are set after commit, so this is
    // only needed if we change the ordering)
    for (const holdKey of redisHoldKeys) {
      await redisClient.del(holdKey).catch(() => {});
    }

    if (error instanceof AppError) throw error;
    throw new AppError('failed to create multi-section order', 500);

  } finally {
    session.endSession();
  }
}
```

#### Test Cases (10)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_event_not_found` | Non-existent event ID | Status 404, "not available" |
| 02 | Validation | `test_validation_02_event_not_on_sale` | Sold-out event | Status 404, "not available" |
| 03 | Success | `test_success_03_multi_section_order_created` | 2 VIP + 4 Orchestra | Order with 6 tickets, both sections updated |
| 04 | Rollback | `test_rollback_04_first_section_released_on_second_failure` | Section 1 OK, section 2 insufficient | Section 1 `held_count` unchanged from original (rolled back) |
| 05 | Rollback | `test_rollback_05_no_orphaned_tickets` | Partial failure | No tickets exist for the failed order |
| 06 | Rollback | `test_rollback_06_no_orphaned_redis_holds` | Partial failure | No Redis hold keys exist |
| 07 | Atomic | `test_atomic_07_availability_check_within_transaction` | Concurrent orders for last seats | Only one succeeds, no overselling |
| 08 | Counters | `test_counters_08_held_count_correct_after_success` | Order 3 from section A, 2 from section B | `A.held_count += 3`, `B.held_count += 2` |
| 09 | Counters | `test_counters_09_held_count_unchanged_after_failure` | Failed order | Both sections' `held_count` unchanged |
| 10 | Response | `test_response_10_order_contains_all_tickets` | Successful multi-section order | `order.tickets.length == total quantity`, correct sections |

**Key test example (test 04 — rollback on partial failure):**

```javascript
it('test_rollback_04_first_section_released_on_second_failure', async () => {
  const event = await createEvent({ status: 'on_sale' });
  const vipSection = await createSection({
    event_id: event._id, name: 'VIP', capacity: 50,
    base_price: 200, sold_count: 0, held_count: 0
  });
  const orchestraSection = await createSection({
    event_id: event._id, name: 'Orchestra', capacity: 100,
    base_price: 100, sold_count: 98, held_count: 0 // Only 2 available
  });

  const res = await request(app)
    .post('/api/v1/orders')
    .send({
      event_id: event._id.toString(),
      sections: [
        { section_id: vipSection._id.toString(), quantity: 2 },
        { section_id: orchestraSection._id.toString(), quantity: 5 } // 5 > 2 available → FAIL
      ]
    })
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).to.equal(400);
  expect(res.body.error).to.include('insufficient capacity');

  // VIP section should be rolled back (buggy code: held_count stays at 2)
  const updatedVip = await Section.findById(vipSection._id);
  expect(updatedVip.held_count).to.equal(0); // Rolled back, NOT 2

  // No orphaned tickets should exist
  const orphanedTickets = await Ticket.find({ event_id: event._id });
  expect(orphanedTickets).to.have.lengthOf(0);

  // No orphaned Redis holds
  const vipHolds = await redisClient.keys(`hold:${vipSection._id}:*`);
  expect(vipHolds).to.have.lengthOf(0);
});
```

---

#### Independence

Only touches `createMultiSectionOrder()` in `order.service.js`. Doesn't affect single-section order pricing (Bug 1), event status transitions (Bug 2), hold-to-purchase counters (Bug 3), refund calculations (Bug 4), ticket transfer (Bug 5), venue scheduling (Bug 6), barcode generation (Bug 7), webhook handling (Bug 8), or cancellation cascades (Bug 9).

**Uniqueness from rental spec:** Rental Bug 8 is a TOCTOU race condition on a single resource (equipment quantity). This bug is about transactional consistency across MULTIPLE resources (multiple sections) with compensating rollback — the failure mode is orphaned partial state across multiple entities, not concurrent access to a single entity. The fix requires MongoDB sessions/transactions and multi-resource cleanup, not just atomic findOneAndUpdate.

---

---

## 6. Feature Candidates (6)

> **Purpose:** Review all 6 candidates and select the desired number. Each is a standalone HackerRank question (codebase-style). Features require implementing **new functionality** from a stub, covering validation, business logic, response formatting, and edge cases. Each implementation is a substantial chunk of code (20-65 lines).
>
> **Research basis:** Feature designs informed by real-world event ticketing platform capabilities — BookMyShow seat maps, Ticketmaster dynamic pricing, StubHub ticket transfers, Eventbrite waitlist systems, and standard refund processing with tiered penalties.
>
> **Test structure:** Each question has **multiple test cases** (6-12) covering validation, core logic, edge cases, and response structure.

### Feature Candidate Overview

| # | Difficulty | Time | Title | Area | Impl Size | Tests |
|---|-----------|------|-------|------|-----------|-------|
| 1 | Easy | ~20-30 min | Seat Availability Map for Event Section | Query / Aggregation | ~25 lines | 8 |
| 2 | Easy | ~20-30 min | Event Schedule with Date Filter and Venue Grouping | Query / Filtering | ~22 lines | 7 |
| 3 | Medium | ~30-45 min | Waitlist with Automatic Position Assignment and Notifications | Business Logic / Queue | ~40 lines | 10 |
| 4 | Medium | ~30-45 min | Ticket Transfer Between Users with Validation Chain | Business Logic / State | ~40 lines | 10 |
| 5 | Hard | ~45-60 min | Dynamic Pricing Engine with Multi-Factor Calculation | Algorithm / Computation | ~55 lines | 11 |
| 6 | Hard | ~45-60 min | Refund Processing with Tiered Penalties and Fee Decomposition | Business Logic / Calculation | ~60 lines | 12 |

---

### Feature 1 (Easy): Seat Availability Map for Event Section

**Time:** ~20-30 min | **Area:** Query / Aggregation | **Implementation Size:** ~25 lines
**Files:** `src/features/seat_availability_map/controller.js` + `src/features/seat_availability_map/routes.js`
**Validates:** Building a real-time availability view by aggregating data from multiple sources (tickets, sections, Redis holds) and presenting a structured response

#### Description

Implement an endpoint that returns a detailed availability breakdown for a specific section of an event. This includes total capacity, sold count, currently held count, available count, sell-through percentage, and the current dynamic pricing tier. This is the data that powers the "seat map" UI on ticketing platforms — showing which sections are available, at what price, and how fast they're selling.

#### Endpoint

```
GET /api/v1/events/:id/sections/:sectionId/seat-map
Auth: No (public)
```

#### Stub Code (`features/seat_availability_map/controller.js`)

```javascript
async function getSeatAvailabilityMap(req, res) {
  const { id: eventId, sectionId } = req.params;

  const section = await Section.findOneActive({ _id: sectionId, event_id: eventId });
  if (!section) {
    return res.status(404).json({ error: 'section not found' });
  }

  /* YOUR CODE HERE */
  return res.json({});
}
```

#### Solution Code

```javascript
async function getSeatAvailabilityMap(req, res) {
  const { id: eventId, sectionId } = req.params;

  const section = await Section.findOneActive({ _id: sectionId, event_id: eventId });
  if (!section) {
    return res.status(404).json({ error: 'section not found' });
  }

  const event = await Event.findOneActive({ _id: eventId });
  if (!event) {
    return res.status(404).json({ error: 'event not found' });
  }

  const available = Math.max(0, section.capacity - section.sold_count - section.held_count);
  const sellThroughPct = section.capacity > 0
    ? Math.round((section.sold_count / section.capacity) * 10000) / 100
    : 0;

  // Determine pricing tier
  const sellThrough = section.capacity > 0 ? section.sold_count / section.capacity : 0;
  let multiplier = 1.0;
  let tier = 'standard';
  if (sellThrough >= 0.90) { multiplier = 2.0; tier = 'peak'; }
  else if (sellThrough >= 0.75) { multiplier = 1.5; tier = 'very_high_demand'; }
  else if (sellThrough >= 0.50) { multiplier = 1.25; tier = 'high_demand'; }

  const currentPrice = Math.round(section.base_price * multiplier * 100) / 100;

  return res.json({
    event_id: eventId,
    event_title: event.title,
    section_id: sectionId,
    section_name: section.name,
    capacity: section.capacity,
    sold: section.sold_count,
    held: section.held_count,
    available,
    sell_through_pct: sellThroughPct,
    pricing: {
      base_price: section.base_price,
      multiplier,
      tier,
      current_price: currentPrice,
      service_fee: Math.round(currentPrice * 0.12 * 100) / 100,
      facility_fee: Math.round(currentPrice * 0.05 * 100) / 100
    },
    status: available > 0 ? 'available' : 'sold_out'
  });
}
```

#### Validation Rules

| # | Condition | Status | Response |
|---|-----------|--------|----------|
| 1 | Section not found or wrong event | 404 | `{"error": "section not found"}` |
| 2 | Event not found | 404 | `{"error": "event not found"}` |

#### Response Format

```json
{
  "event_id": "ObjectId",
  "event_title": "Rock Concert 2024",
  "section_id": "ObjectId",
  "section_name": "Orchestra",
  "capacity": 500,
  "sold": 380,
  "held": 10,
  "available": 110,
  "sell_through_pct": 76.0,
  "pricing": {
    "base_price": 100.0,
    "multiplier": 1.5,
    "tier": "very_high_demand",
    "current_price": 150.0,
    "service_fee": 18.0,
    "facility_fee": 7.5
  },
  "status": "available"
}
```

#### Test Cases (8)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_section_not_found` | Non-existent section ID | Status 404 |
| 02 | Validation | `test_validation_02_event_not_found` | Non-existent event ID | Status 404 |
| 03 | Availability | `test_availability_03_correct_available_count` | 100 capacity, 60 sold, 10 held | `available == 30` |
| 04 | Availability | `test_availability_04_sold_out_status` | 100 capacity, 100 sold | `status == "sold_out"`, `available == 0` |
| 05 | Pricing | `test_pricing_05_correct_tier_and_multiplier` | 80% sell-through | `tier == "very_high_demand"`, `multiplier == 1.5` |
| 06 | Pricing | `test_pricing_06_fees_calculated_correctly` | base_price $100, 1.5x multiplier | `service_fee == 18.0`, `facility_fee == 7.5` |
| 07 | Logic | `test_logic_07_sell_through_percentage_correct` | 250 of 500 sold | `sell_through_pct == 50.0` |
| 08 | Response | `test_response_08_contains_all_required_fields` | Check response shape | All fields present with correct types |

**Key test example (test 03 — availability calculation):**

```javascript
it('test_availability_03_correct_available_count', async () => {
  const event = await createEvent({ status: 'on_sale' });
  const section = await createSection({
    event_id: event._id, name: 'Orchestra',
    capacity: 100, base_price: 75, sold_count: 60, held_count: 10
  });

  const res = await request(app)
    .get(`/api/v1/events/${event._id}/sections/${section._id}/seat-map`);

  expect(res.status).to.equal(200);
  expect(res.body.capacity).to.equal(100);
  expect(res.body.sold).to.equal(60);
  expect(res.body.held).to.equal(10);
  expect(res.body.available).to.equal(30);
  expect(res.body.sell_through_pct).to.equal(60.0);
  expect(res.body.status).to.equal('available');
});
```

#### Independence

Only touches `features/seat_availability_map/`. Read-only endpoint — doesn't modify state. Doesn't interact with order flow, payment, refund, cache, auth, or any bug code path.

---

### Feature 2 (Easy): Event Schedule with Date Filter and Venue Grouping

**Time:** ~20-30 min | **Area:** Query / Filtering | **Implementation Size:** ~22 lines
**Files:** `src/features/event_schedule/controller.js` + `src/features/event_schedule/routes.js`
**Validates:** Building filtered and grouped query results with date range filtering, multi-model joins, and structured response composition

#### Description

Implement an endpoint that returns a schedule of upcoming events within a date range, grouped by venue. This powers the "What's On" page — users pick a date range and see all events organized by venue location. Each venue group includes the venue name, city, and its scheduled events with section/pricing summary.

#### Endpoint

```
GET /api/v1/events/schedule?start_date=<ISO8601>&end_date=<ISO8601>
Auth: No (public)
```

#### Stub Code (`features/event_schedule/controller.js`)

```javascript
async function getEventSchedule(req, res) {
  const { start_date, end_date } = req.query;

  /* YOUR CODE HERE */
  return res.json({});
}
```

#### Solution Code

```javascript
async function getEventSchedule(req, res) {
  const { start_date, end_date } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required' });
  }

  const startDate = new Date(start_date);
  const endDate = new Date(end_date);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return res.status(400).json({ error: 'invalid date format' });
  }

  if (endDate <= startDate) {
    return res.status(400).json({ error: 'end_date must be after start_date' });
  }

  const events = await Event.findActive({
    status: { $in: ['on_sale', 'sold_out'] },
    start_date: { $gte: startDate, $lte: endDate }
  }).sort({ start_date: 1 });

  const venueIds = [...new Set(events.map(e => e.venue_id.toString()))];
  const venues = await Venue.find({ _id: { $in: venueIds } });
  const venueMap = new Map(venues.map(v => [v._id.toString(), v]));

  // Get section summaries for each event
  const eventIds = events.map(e => e._id);
  const sections = await Section.findActive({ event_id: { $in: eventIds } });

  const sectionsByEvent = {};
  for (const section of sections) {
    const eid = section.event_id.toString();
    if (!sectionsByEvent[eid]) sectionsByEvent[eid] = [];
    sectionsByEvent[eid].push(section);
  }

  // Group events by venue
  const grouped = {};
  for (const event of events) {
    const vid = event.venue_id.toString();
    const venue = venueMap.get(vid);
    if (!grouped[vid]) {
      grouped[vid] = {
        venue_id: vid,
        venue_name: venue?.name || 'Unknown',
        city: venue?.city || 'Unknown',
        events: []
      };
    }

    const eventSections = sectionsByEvent[event._id.toString()] || [];
    const priceRange = eventSections.length > 0
      ? { min: Math.min(...eventSections.map(s => s.base_price)), max: Math.max(...eventSections.map(s => s.base_price)) }
      : { min: 0, max: 0 };
    const totalAvailable = eventSections.reduce((sum, s) => sum + Math.max(0, s.capacity - s.sold_count - s.held_count), 0);

    grouped[vid].events.push({
      event_id: event._id,
      title: event.title,
      category: event.category,
      start_date: event.start_date,
      end_date: event.end_date,
      status: event.status,
      sections_count: eventSections.length,
      total_available: totalAvailable,
      price_range: priceRange
    });
  }

  return res.json({
    period_start: startDate.toISOString(),
    period_end: endDate.toISOString(),
    venues: Object.values(grouped),
    total_events: events.length
  });
}
```

#### Validation Rules

| # | Condition | Status | Response |
|---|-----------|--------|----------|
| 1 | Missing dates | 400 | `{"error": "start_date and end_date are required"}` |
| 2 | Invalid date format | 400 | `{"error": "invalid date format"}` |
| 3 | end_date <= start_date | 400 | `{"error": "end_date must be after start_date"}` |

#### Response Format

```json
{
  "period_start": "2024-06-01T00:00:00.000Z",
  "period_end": "2024-06-30T00:00:00.000Z",
  "venues": [
    {
      "venue_id": "ObjectId",
      "venue_name": "Madison Square Garden",
      "city": "New York",
      "events": [
        {
          "event_id": "ObjectId",
          "title": "Rock Concert",
          "category": "concert",
          "start_date": "2024-06-15T19:00:00.000Z",
          "end_date": "2024-06-15T23:00:00.000Z",
          "status": "on_sale",
          "sections_count": 4,
          "total_available": 2500,
          "price_range": { "min": 50.0, "max": 250.0 }
        }
      ]
    }
  ],
  "total_events": 5
}
```

#### Test Cases (7)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_missing_dates` | No dates provided | Status 400 |
| 02 | Validation | `test_validation_02_invalid_date_format` | Malformed date string | Status 400 |
| 03 | Validation | `test_validation_03_end_before_start` | end_date <= start_date | Status 400 |
| 04 | Grouping | `test_grouping_04_events_grouped_by_venue` | 2 venues, 3 events each | 2 venue groups, 3 events in each |
| 05 | Filter | `test_filter_05_only_events_in_date_range` | Events before/in/after range | Only in-range events returned |
| 06 | Logic | `test_logic_06_price_range_calculated_correctly` | Event with sections $50, $100, $200 | `price_range.min == 50`, `price_range.max == 200` |
| 07 | Response | `test_response_07_total_available_sums_sections` | 3 sections with different availability | `total_available` is sum |

**Key test example (test 04 — venue grouping):**

```javascript
it('test_grouping_04_events_grouped_by_venue', async () => {
  const venue1 = await createVenue({ name: 'Madison Square Garden', city: 'NYC' });
  const venue2 = await createVenue({ name: 'Staples Center', city: 'LA' });

  await createEvent({ venue_id: venue1._id, title: 'Concert A', status: 'on_sale', start_date: futureDate(5) });
  await createEvent({ venue_id: venue1._id, title: 'Concert B', status: 'on_sale', start_date: futureDate(10) });
  await createEvent({ venue_id: venue2._id, title: 'Basketball', status: 'on_sale', start_date: futureDate(7) });

  const res = await request(app)
    .get('/api/v1/events/schedule')
    .query({ start_date: futureDate(1).toISOString(), end_date: futureDate(15).toISOString() });

  expect(res.status).to.equal(200);
  expect(res.body.venues).to.have.lengthOf(2);
  expect(res.body.total_events).to.equal(3);

  const msgVenue = res.body.venues.find(v => v.venue_name === 'Madison Square Garden');
  expect(msgVenue.events).to.have.lengthOf(2);
  expect(msgVenue.city).to.equal('NYC');
});
```

#### Independence

Only touches `features/event_schedule/`. Read-only endpoint — doesn't modify state. Doesn't interact with order flow, payment, refund, cache mutations, auth, or any bug code path.

---

### Feature 3 (Medium): Waitlist with Automatic Position Assignment and Notifications

**Time:** ~30-45 min | **Area:** Business Logic / Queue | **Implementation Size:** ~40 lines
**Files:** `src/features/waitlist_management/controller.js` + `src/features/waitlist_management/routes.js`
**Validates:** Building an ordered queue system with automatic position assignment, duplicate prevention, status-gated access, and position query with ahead-count computation

#### Description

Implement a waitlist system for sold-out events. When all sections of an event reach capacity, customers can join a waitlist. The system must: verify the event is sold out, prevent duplicate entries, assign sequential positions, and provide a query endpoint showing the user's position and how many people are ahead.

When a ticket becomes available (via refund or cancellation), the system notifies the next person on the waitlist via a Bull job.

#### Endpoints

```
POST /api/v1/events/:id/waitlist
Auth: Yes (Bearer token)
Body: (empty)

GET /api/v1/events/:id/waitlist
Auth: Yes (Bearer token)
```

#### Stub Code (`features/waitlist_management/controller.js`)

```javascript
async function joinWaitlist(req, res) {
  const eventId = req.params.id;
  const userId = req.user.id;

  /* YOUR CODE HERE */
  return res.json({});
}

async function getWaitlistPosition(req, res) {
  const eventId = req.params.id;
  const userId = req.user.id;

  /* YOUR CODE HERE */
  return res.json({});
}
```

#### Solution Code

```javascript
async function joinWaitlist(req, res) {
  const eventId = req.params.id;
  const userId = req.user.id;

  const event = await Event.findOneActive({ _id: eventId });
  if (!event) {
    return res.status(404).json({ error: 'event not found' });
  }

  if (event.status !== 'sold_out') {
    return res.status(400).json({ error: 'waitlist is only available for sold-out events' });
  }

  // Check for existing entry
  const existing = await WaitlistEntry.findOne({
    event_id: eventId, user_id: userId, status: 'waiting'
  });
  if (existing) {
    return res.status(409).json({ error: 'already on waitlist for this event' });
  }

  // Atomic position assignment using findOneAndUpdate counter
  const counter = await mongoose.connection.db.collection('waitlist_counters')
    .findOneAndUpdate(
      { event_id: new mongoose.Types.ObjectId(eventId) },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after' }
    );

  const entry = await WaitlistEntry.create({
    event_id: eventId,
    user_id: userId,
    position: counter.seq,
    status: 'waiting'
  });

  const totalAhead = await WaitlistEntry.countDocuments({
    event_id: eventId, position: { $lt: entry.position }, status: 'waiting'
  });

  return res.status(201).json({
    waitlist_id: entry._id,
    event_id: eventId,
    position: entry.position,
    ahead: totalAhead,
    status: 'waiting',
    joined_at: entry.created_at
  });
}

async function getWaitlistPosition(req, res) {
  const eventId = req.params.id;
  const userId = req.user.id;

  const entry = await WaitlistEntry.findOne({
    event_id: eventId, user_id: userId, status: 'waiting'
  });
  if (!entry) {
    return res.status(404).json({ error: 'not on waitlist for this event' });
  }

  const totalAhead = await WaitlistEntry.countDocuments({
    event_id: eventId, position: { $lt: entry.position }, status: 'waiting'
  });

  const totalWaiting = await WaitlistEntry.countDocuments({
    event_id: eventId, status: 'waiting'
  });

  return res.json({
    waitlist_id: entry._id,
    event_id: eventId,
    position: entry.position,
    ahead: totalAhead,
    total_waiting: totalWaiting,
    status: entry.status,
    joined_at: entry.created_at
  });
}
```

#### Validation Rules

| # | Condition | Status | Response |
|---|-----------|--------|----------|
| 1 | Event not found | 404 | `{"error": "event not found"}` |
| 2 | Event not sold out | 400 | `{"error": "waitlist is only available for sold-out events"}` |
| 3 | Already on waitlist | 409 | `{"error": "already on waitlist for this event"}` |
| 4 | Not on waitlist (GET) | 404 | `{"error": "not on waitlist for this event"}` |

#### Response Format (POST)

```json
{
  "waitlist_id": "ObjectId",
  "event_id": "ObjectId",
  "position": 15,
  "ahead": 14,
  "status": "waiting",
  "joined_at": "2024-06-15T10:30:00.000Z"
}
```

#### Test Cases (10)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_event_not_found` | Non-existent event | Status 404 |
| 02 | Validation | `test_validation_02_event_not_sold_out` | Join on_sale event waitlist | Status 400, "sold-out" |
| 03 | Validation | `test_validation_03_duplicate_entry_rejected` | Join twice | Status 409, "already on waitlist" |
| 04 | Logic | `test_logic_04_first_user_gets_position_1` | First join | `position == 1`, `ahead == 0` |
| 05 | Logic | `test_logic_05_sequential_positions` | 3 users join | Positions 1, 2, 3 respectively |
| 06 | Logic | `test_logic_06_ahead_count_correct` | User at position 3 queries | `ahead == 2` |
| 07 | Logic | `test_logic_07_total_waiting_correct` | 5 users waiting, query | `total_waiting == 5` |
| 08 | Logic | `test_logic_08_notified_users_not_counted_ahead` | Position 1 notified, position 2 queries | `ahead == 0` |
| 09 | Auth | `test_auth_09_requires_authentication` | No JWT token | Status 401 |
| 10 | Response | `test_response_10_join_response_has_required_fields` | Check response shape | `waitlist_id`, `position`, `ahead`, `status`, `joined_at` present |

**Key test example (test 05 — sequential positions):**

```javascript
it('test_logic_05_sequential_positions', async () => {
  const event = await createEvent({ status: 'sold_out' });

  const res1 = await request(app)
    .post(`/api/v1/events/${event._id}/waitlist`)
    .set('Authorization', `Bearer ${tokens[0]}`);
  const res2 = await request(app)
    .post(`/api/v1/events/${event._id}/waitlist`)
    .set('Authorization', `Bearer ${tokens[1]}`);
  const res3 = await request(app)
    .post(`/api/v1/events/${event._id}/waitlist`)
    .set('Authorization', `Bearer ${tokens[2]}`);

  expect(res1.body.position).to.equal(1);
  expect(res2.body.position).to.equal(2);
  expect(res3.body.position).to.equal(3);

  expect(res1.body.ahead).to.equal(0);
  expect(res2.body.ahead).to.equal(1);
  expect(res3.body.ahead).to.equal(2);
});
```

#### Independence

Only touches `features/waitlist_management/`. Self-contained queue system — doesn't interact with order creation, payment, refund, pricing, cache, auth middleware, or any bug code path.

---

### Feature 4 (Medium): Ticket Transfer Between Users with Validation Chain

**Time:** ~30-45 min | **Area:** Business Logic / State | **Implementation Size:** ~40 lines
**Files:** `src/features/ticket_transfer/controller.js` + `src/features/ticket_transfer/routes.js`
**Validates:** Building a multi-step ownership transfer with comprehensive validation, state transitions across related documents, and creating audit trails for multi-party transactions

#### Description

Implement an endpoint that allows a ticket holder to transfer a confirmed ticket to another registered user by email. The transfer must: verify ownership, validate the ticket is transferable (confirmed status, event not past), find the recipient by email, invalidate the original ticket (set status to `transferred`), create a new ticket for the recipient, and return a complete transfer record.

This is the kind of peer-to-peer ticket transfer system used by Ticketmaster's "Transfer Tickets" feature and StubHub's resale flow.

#### Endpoint

```
POST /api/v1/tickets/:id/transfer
Auth: Yes (Bearer token)
Body: { "to_email": "recipient@example.com" }
```

#### Stub Code (`features/ticket_transfer/controller.js`)

```javascript
async function transferTicket(req, res) {
  const ticketId = req.params.id;
  const fromUserId = req.user.id;

  /* YOUR CODE HERE */
  return res.json({});
}
```

#### Solution Code

```javascript
async function transferTicket(req, res) {
  const ticketId = req.params.id;
  const fromUserId = req.user.id;
  const { to_email } = req.body;

  if (!to_email) {
    return res.status(400).json({ error: 'to_email is required' });
  }

  const ticket = await Ticket.findOneActive({ _id: ticketId, user_id: fromUserId });
  if (!ticket) {
    return res.status(404).json({ error: 'ticket not found' });
  }

  if (ticket.status !== 'confirmed') {
    return res.status(400).json({ error: 'only confirmed tickets can be transferred' });
  }

  // Check event hasn't passed
  const event = await Event.findOneActive({ _id: ticket.event_id });
  if (!event) {
    return res.status(400).json({ error: 'event not found' });
  }
  if (new Date(event.start_date) <= new Date()) {
    return res.status(400).json({ error: 'cannot transfer tickets for past events' });
  }

  const toUser = await User.findOneActive({ email: to_email.toLowerCase() });
  if (!toUser) {
    return res.status(404).json({ error: 'recipient user not found' });
  }

  if (toUser._id.toString() === fromUserId.toString()) {
    return res.status(400).json({ error: 'cannot transfer ticket to yourself' });
  }

  // Invalidate original ticket
  ticket.status = 'transferred';
  ticket.transferred_at = new Date();
  await ticket.save();

  // Create new ticket for recipient
  const newTicket = await Ticket.create({
    order_id: ticket.order_id,
    event_id: ticket.event_id,
    section_id: ticket.section_id,
    user_id: toUser._id,
    original_user_id: ticket.original_user_id,
    status: 'confirmed',
    unit_price: ticket.unit_price,
    service_fee: ticket.service_fee,
    facility_fee: ticket.facility_fee
  });

  return res.json({
    transfer_id: `xfer_${ticket._id}_${newTicket._id}`,
    original_ticket_id: ticket._id,
    new_ticket_id: newTicket._id,
    from_user: fromUserId,
    to_user: toUser._id,
    to_email: to_email.toLowerCase(),
    event_title: event.title,
    section_name: (await Section.findById(ticket.section_id))?.name,
    transferred_at: ticket.transferred_at
  });
}
```

#### Validation Rules

| # | Condition | Status | Response |
|---|-----------|--------|----------|
| 1 | Missing to_email | 400 | `{"error": "to_email is required"}` |
| 2 | Ticket not found or not owned | 404 | `{"error": "ticket not found"}` |
| 3 | Ticket not confirmed | 400 | `{"error": "only confirmed tickets can be transferred"}` |
| 4 | Event already passed | 400 | `{"error": "cannot transfer tickets for past events"}` |
| 5 | Recipient not found | 404 | `{"error": "recipient user not found"}` |
| 6 | Transfer to self | 400 | `{"error": "cannot transfer ticket to yourself"}` |

#### Response Format

```json
{
  "transfer_id": "xfer_ticketId_newTicketId",
  "original_ticket_id": "ObjectId",
  "new_ticket_id": "ObjectId",
  "from_user": "ObjectId",
  "to_user": "ObjectId",
  "to_email": "recipient@example.com",
  "event_title": "Rock Concert",
  "section_name": "Orchestra",
  "transferred_at": "2024-06-15T10:30:00.000Z"
}
```

#### Test Cases (10)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_missing_to_email` | No email in body | Status 400, "to_email is required" |
| 02 | Validation | `test_validation_02_ticket_not_found` | Non-existent ticket | Status 404 |
| 03 | Validation | `test_validation_03_not_ticket_owner` | Transfer other user's ticket | Status 404 |
| 04 | Validation | `test_validation_04_ticket_not_confirmed` | Transfer refunded ticket | Status 400, "only confirmed" |
| 05 | Validation | `test_validation_05_event_already_passed` | Transfer for past event | Status 400, "past events" |
| 06 | Validation | `test_validation_06_recipient_not_found` | Non-existent email | Status 404, "recipient" |
| 07 | Validation | `test_validation_07_cannot_transfer_to_self` | Own email | Status 400, "yourself" |
| 08 | Transfer | `test_transfer_08_original_ticket_invalidated` | Successful transfer | `original.status == 'transferred'` |
| 09 | Transfer | `test_transfer_09_new_ticket_created_for_recipient` | Successful transfer | New ticket has recipient's user_id, status confirmed |
| 10 | Transfer | `test_transfer_10_pricing_preserved` | Successful transfer | `new_ticket.unit_price == original.unit_price` |

**Key test example (test 08 — transfer flow):**

```javascript
it('test_transfer_08_original_ticket_invalidated', async () => {
  const ticket = await createConfirmedTicket({
    user_id: alice._id, event_id: event._id,
    section_id: section._id, unit_price: 150
  });

  const res = await request(app)
    .post(`/api/v1/tickets/${ticket._id}/transfer`)
    .send({ to_email: bob.email })
    .set('Authorization', `Bearer ${aliceToken}`);

  expect(res.status).to.equal(200);
  expect(res.body.to_email).to.equal(bob.email);

  const original = await Ticket.findById(ticket._id);
  expect(original.status).to.equal('transferred');

  const newTicket = await Ticket.findById(res.body.new_ticket_id);
  expect(newTicket.user_id.toString()).to.equal(bob._id.toString());
  expect(newTicket.status).to.equal('confirmed');
  expect(newTicket.unit_price).to.equal(150);
});
```

#### Independence

Only touches `features/ticket_transfer/`. Self-contained transfer logic — doesn't interact with order creation, payment, refund, pricing, cache, waitlist, or any bug code path.

---

### Feature 5 (Hard): Dynamic Pricing Engine with Multi-Factor Calculation

**Time:** ~45-60 min | **Area:** Algorithm / Computation | **Implementation Size:** ~55 lines
**Files:** `src/features/dynamic_pricing/controller.js` + `src/features/dynamic_pricing/routes.js`
**Validates:** Building a multi-factor pricing algorithm that considers demand (sell-through), time proximity (urgency), and quantity (bulk adjustments), with proper rounding, fee decomposition, and comparison against base price

#### Description

Implement a dynamic pricing preview endpoint that calculates the current ticket price for a section based on multiple factors: (1) **demand multiplier** from sell-through percentage (standard tiers), (2) **urgency multiplier** based on how close the event date is, (3) **quantity adjustment** for bulk purchases (discount for 4+ tickets). The endpoint returns a complete price breakdown including per-ticket price, all fees, quantity discounts, and the total for the requested quantity.

**Urgency Multiplier (time to event):**

| Time to Event | Urgency Multiplier |
|---------------|-------------------|
| > 30 days | 1.0x (no urgency) |
| 14–30 days | 1.1x |
| 7–14 days | 1.2x |
| 1–7 days | 1.3x |
| < 24 hours | 1.5x |

**Quantity Discount:**

| Quantity | Discount |
|----------|----------|
| 1–3 tickets | 0% |
| 4–7 tickets | 5% off per ticket |
| 8+ tickets | 10% off per ticket |

The final price per ticket is: `base_price × demand_multiplier × urgency_multiplier × (1 - quantity_discount)`

#### Endpoint

```
GET /api/v1/events/:id/pricing?section_id=<id>&quantity=<n>
Auth: Yes (Bearer token)
```

#### Stub Code (`features/dynamic_pricing/controller.js`)

```javascript
async function getDynamicPricing(req, res) {
  const eventId = req.params.id;
  const { section_id, quantity } = req.query;

  /* YOUR CODE HERE */
  return res.json({});
}
```

#### Solution Code

```javascript
async function getDynamicPricing(req, res) {
  const eventId = req.params.id;
  const { section_id, quantity: qtyStr } = req.query;

  if (!section_id) {
    return res.status(400).json({ error: 'section_id is required' });
  }

  const quantity = parseInt(qtyStr, 10);
  if (!quantity || quantity < 1) {
    return res.status(400).json({ error: 'quantity must be a positive integer' });
  }

  const event = await Event.findOneActive({ _id: eventId });
  if (!event) {
    return res.status(404).json({ error: 'event not found' });
  }

  if (event.status !== 'on_sale') {
    return res.status(400).json({ error: 'event is not available for purchase' });
  }

  const section = await Section.findOneActive({ _id: section_id, event_id: eventId });
  if (!section) {
    return res.status(404).json({ error: 'section not found' });
  }

  const available = section.capacity - section.sold_count - section.held_count;
  if (quantity > available) {
    return res.status(400).json({ error: `only ${available} seats available` });
  }

  // 1. Demand multiplier (sell-through based)
  const sellThrough = section.capacity > 0 ? section.sold_count / section.capacity : 0;
  let demandMultiplier = 1.0;
  let demandTier = 'standard';
  if (sellThrough >= 0.90) { demandMultiplier = 2.0; demandTier = 'peak'; }
  else if (sellThrough >= 0.75) { demandMultiplier = 1.5; demandTier = 'very_high_demand'; }
  else if (sellThrough >= 0.50) { demandMultiplier = 1.25; demandTier = 'high_demand'; }

  // 2. Urgency multiplier (time to event)
  const hoursToEvent = (new Date(event.start_date) - new Date()) / (1000 * 60 * 60);
  let urgencyMultiplier = 1.0;
  let urgencyTier = 'normal';
  if (hoursToEvent < 24) { urgencyMultiplier = 1.5; urgencyTier = 'last_minute'; }
  else if (hoursToEvent < 168) { urgencyMultiplier = 1.3; urgencyTier = 'this_week'; }
  else if (hoursToEvent < 336) { urgencyMultiplier = 1.2; urgencyTier = 'next_week'; }
  else if (hoursToEvent < 720) { urgencyMultiplier = 1.1; urgencyTier = 'this_month'; }

  // 3. Quantity discount
  let quantityDiscount = 0;
  let quantityTier = 'standard';
  if (quantity >= 8) { quantityDiscount = 0.10; quantityTier = 'group_large'; }
  else if (quantity >= 4) { quantityDiscount = 0.05; quantityTier = 'group_small'; }

  // Calculate per-ticket price
  const rawPrice = section.base_price * demandMultiplier * urgencyMultiplier;
  const discountedPrice = rawPrice * (1 - quantityDiscount);
  const unitPrice = Math.round(discountedPrice * 100) / 100;

  // Calculate fees per ticket
  const serviceFee = Math.round(unitPrice * 0.12 * 100) / 100;
  const facilityFee = Math.round(unitPrice * 0.05 * 100) / 100;
  const perTicketTotal = unitPrice + serviceFee + facilityFee;

  // Order totals
  const subtotal = Math.round(unitPrice * quantity * 100) / 100;
  const totalServiceFees = Math.round(serviceFee * quantity * 100) / 100;
  const totalFacilityFees = Math.round(facilityFee * quantity * 100) / 100;
  const processingFee = 3.00;
  const orderTotal = Math.round((subtotal + totalServiceFees + totalFacilityFees + processingFee) * 100) / 100;

  return res.json({
    event_id: eventId,
    section_id: section._id,
    section_name: section.name,
    quantity,
    base_price: section.base_price,
    pricing_factors: {
      demand: { multiplier: demandMultiplier, tier: demandTier, sell_through_pct: Math.round(sellThrough * 10000) / 100 },
      urgency: { multiplier: urgencyMultiplier, tier: urgencyTier, hours_to_event: Math.round(hoursToEvent) },
      quantity: { discount_pct: quantityDiscount * 100, tier: quantityTier }
    },
    per_ticket: {
      unit_price: unitPrice,
      service_fee: serviceFee,
      facility_fee: facilityFee,
      total: Math.round(perTicketTotal * 100) / 100
    },
    order_total: {
      subtotal,
      service_fees: totalServiceFees,
      facility_fees: totalFacilityFees,
      processing_fee: processingFee,
      total: orderTotal
    },
    savings: quantity >= 4
      ? Math.round((rawPrice - discountedPrice) * quantity * 100) / 100
      : 0
  });
}
```

#### Validation Rules

| # | Condition | Status | Response |
|---|-----------|--------|----------|
| 1 | Missing section_id | 400 | `{"error": "section_id is required"}` |
| 2 | Invalid quantity | 400 | `{"error": "quantity must be a positive integer"}` |
| 3 | Event not found | 404 | `{"error": "event not found"}` |
| 4 | Event not on_sale | 400 | `{"error": "event is not available for purchase"}` |
| 5 | Section not found | 404 | `{"error": "section not found"}` |
| 6 | Not enough seats | 400 | `{"error": "only N seats available"}` |

#### Response Format

```json
{
  "event_id": "ObjectId",
  "section_id": "ObjectId",
  "section_name": "VIP",
  "quantity": 4,
  "base_price": 100.0,
  "pricing_factors": {
    "demand": { "multiplier": 1.5, "tier": "very_high_demand", "sell_through_pct": 80.0 },
    "urgency": { "multiplier": 1.2, "tier": "next_week", "hours_to_event": 240 },
    "quantity": { "discount_pct": 5, "tier": "group_small" }
  },
  "per_ticket": {
    "unit_price": 171.0,
    "service_fee": 20.52,
    "facility_fee": 8.55,
    "total": 200.07
  },
  "order_total": {
    "subtotal": 684.0,
    "service_fees": 82.08,
    "facility_fees": 34.20,
    "processing_fee": 3.00,
    "total": 803.28
  },
  "savings": 36.0
}
```

#### Test Cases (11)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_missing_section_id` | No section_id | Status 400 |
| 02 | Validation | `test_validation_02_invalid_quantity` | `quantity=0` | Status 400 |
| 03 | Validation | `test_validation_03_event_not_on_sale` | Sold-out event | Status 400 |
| 04 | Validation | `test_validation_04_not_enough_seats` | Request 10, only 3 available | Status 400 |
| 05 | Demand | `test_demand_05_standard_tier_below_50pct` | 20% sold | `demand.multiplier == 1.0` |
| 06 | Demand | `test_demand_06_peak_tier_above_90pct` | 95% sold | `demand.multiplier == 2.0` |
| 07 | Urgency | `test_urgency_07_last_minute_multiplier` | Event in 12 hours | `urgency.multiplier == 1.5` |
| 08 | Urgency | `test_urgency_08_no_urgency_30plus_days` | Event in 45 days | `urgency.multiplier == 1.0` |
| 09 | Quantity | `test_quantity_09_group_discount_4_tickets` | 4 tickets | `quantity.discount_pct == 5`, savings > 0 |
| 10 | Pricing | `test_pricing_10_all_factors_combined` | 80% sold, 5 days out, 6 tickets | Price = base × 1.5 × 1.3 × 0.95 |
| 11 | Response | `test_response_11_complete_price_breakdown` | Check response shape | All nested fields present |

**Key test example (test 10 — all factors combined):**

```javascript
it('test_pricing_10_all_factors_combined', async () => {
  const event = await createEvent({
    status: 'on_sale',
    start_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) // 5 days out
  });
  const section = await createSection({
    event_id: event._id, capacity: 100, base_price: 100,
    sold_count: 80, held_count: 0 // 80% sell-through
  });

  const res = await request(app)
    .get(`/api/v1/events/${event._id}/pricing`)
    .query({ section_id: section._id.toString(), quantity: 6 })
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).to.equal(200);
  expect(res.body.pricing_factors.demand.multiplier).to.equal(1.5);   // 80% → very_high
  expect(res.body.pricing_factors.urgency.multiplier).to.equal(1.3);  // 5 days → this_week
  expect(res.body.pricing_factors.quantity.discount_pct).to.equal(5); // 6 tickets → 5%

  // $100 × 1.5 × 1.3 × 0.95 = $185.25
  expect(res.body.per_ticket.unit_price).to.equal(185.25);
  expect(res.body.savings).to.be.greaterThan(0);
});
```

#### Independence

Only touches `features/dynamic_pricing/`. Read-only endpoint — doesn't modify state. Doesn't interact with order creation, payment, refund, cache, auth middleware, waitlist, or any bug code path.

---

### Feature 6 (Hard): Refund Processing with Tiered Penalties and Fee Decomposition

**Time:** ~45-60 min | **Area:** Business Logic / Calculation | **Implementation Size:** ~60 lines
**Files:** `src/features/refund_processing/controller.js` + `src/features/refund_processing/routes.js`
**Validates:** Complex multi-tier business rules with time-based penalty calculation, multi-component fee handling where different components have different refund policies, and state updates across multiple models

#### Description

Implement a refund endpoint that processes ticket refunds with time-based penalty tiers. The refund amount depends on how far before the event the refund is requested. Different fee components have different refund rules: base ticket price is subject to the penalty tier, service fees are **never** refunded, facility fees are only refunded on organizer cancellation, and the processing fee is never refunded.

The endpoint must also handle partial refunds (refunding specific tickets from a multi-ticket order), update ticket statuses, decrement section sold counts, and create payment refund records.

#### Endpoint

```
POST /api/v1/orders/:id/refund
Auth: Yes (Bearer token)
Body: { "ticket_ids": ["id1", "id2"] } (optional — omit for full order refund)
```

#### Stub Code (`features/refund_processing/controller.js`)

```javascript
async function processRefund(req, res) {
  const orderId = req.params.id;
  const userId = req.user.id;

  /* YOUR CODE HERE */
  return res.json({});
}
```

#### Solution Code

```javascript
async function processRefund(req, res) {
  const orderId = req.params.id;
  const userId = req.user.id;
  const { ticket_ids } = req.body || {};

  const order = await Order.findOneActive({ _id: orderId, user_id: userId });
  if (!order) {
    return res.status(404).json({ error: 'order not found' });
  }

  if (!['confirmed', 'partially_refunded'].includes(order.status)) {
    return res.status(400).json({ error: 'order is not eligible for refund' });
  }

  const event = await Event.findOneActive({ _id: order.event_id });
  if (!event) {
    return res.status(400).json({ error: 'event not found' });
  }

  // Determine refund tier
  const hoursUntilEvent = (new Date(event.start_date) - new Date()) / (1000 * 60 * 60);
  const isOrganizerCancellation = event.status === 'cancelled';

  let refundPercentage;
  let tier;

  if (isOrganizerCancellation) {
    refundPercentage = 1.0;
    tier = 'organizer_cancellation';
  } else if (hoursUntilEvent > 168) {
    refundPercentage = 1.0;
    tier = 'full_refund';
  } else if (hoursUntilEvent > 72) {
    refundPercentage = 0.75;
    tier = '75_percent';
  } else if (hoursUntilEvent > 24) {
    refundPercentage = 0.50;
    tier = '50_percent';
  } else {
    return res.status(400).json({ error: 'refunds not available within 24 hours of event' });
  }

  // Get eligible tickets
  let ticketsToRefund;
  if (ticket_ids && ticket_ids.length > 0) {
    ticketsToRefund = await Ticket.find({
      _id: { $in: ticket_ids },
      order_id: orderId,
      status: 'confirmed',
      deleted_at: null
    });
    if (ticketsToRefund.length !== ticket_ids.length) {
      return res.status(400).json({ error: 'some tickets are not eligible for refund' });
    }
  } else {
    ticketsToRefund = await Ticket.find({
      order_id: orderId, status: 'confirmed', deleted_at: null
    });
  }

  if (ticketsToRefund.length === 0) {
    return res.status(400).json({ error: 'no eligible tickets to refund' });
  }

  // Calculate refund amounts
  const baseRefund = ticketsToRefund.reduce((sum, t) => sum + t.unit_price, 0);
  const penalizedBaseRefund = Math.round(baseRefund * refundPercentage * 100) / 100;

  const facilityFeeRefund = isOrganizerCancellation
    ? Math.round(ticketsToRefund.reduce((sum, t) => sum + t.facility_fee, 0) * 100) / 100
    : 0;

  const totalRefund = penalizedBaseRefund + facilityFeeRefund;

  // Create refund payment
  await Payment.create({
    order_id: orderId, user_id: userId, amount: totalRefund,
    type: 'refund', status: 'pending',
    idempotency_key: `refund_${orderId}_${ticket_ids ? ticket_ids.sort().join('_') : 'full'}_${Date.now()}`
  });

  // Update ticket statuses
  await Ticket.updateMany(
    { _id: { $in: ticketsToRefund.map(t => t._id) } },
    { $set: { status: 'refunded' } }
  );

  // Decrement section sold_count
  const sectionCounts = {};
  for (const ticket of ticketsToRefund) {
    const sid = ticket.section_id.toString();
    sectionCounts[sid] = (sectionCounts[sid] || 0) + 1;
  }
  for (const [sectionId, count] of Object.entries(sectionCounts)) {
    await Section.findByIdAndUpdate(sectionId, { $inc: { sold_count: -count } });
  }

  // Update order status
  const remainingConfirmed = await Ticket.countDocuments({
    order_id: orderId, status: 'confirmed', deleted_at: null
  });
  order.status = remainingConfirmed === 0 ? 'refunded' : 'partially_refunded';
  await order.save();

  // Compute non-refundable amounts for transparency
  const serviceFeeTotal = ticketsToRefund.reduce((sum, t) => sum + t.service_fee, 0);
  const nonRefundableFacilityFee = isOrganizerCancellation
    ? 0
    : ticketsToRefund.reduce((sum, t) => sum + t.facility_fee, 0);
  const penaltyAmount = Math.round(baseRefund * (1 - refundPercentage) * 100) / 100;

  return res.json({
    order_id: orderId,
    tickets_refunded: ticketsToRefund.length,
    refund_tier: tier,
    refund_percentage: refundPercentage * 100,
    breakdown: {
      base_ticket_total: baseRefund,
      penalty_amount: penaltyAmount,
      base_refund: penalizedBaseRefund,
      facility_fee_refund: facilityFeeRefund,
      service_fee_refund: 0,
      processing_fee_refund: 0
    },
    total_refund: totalRefund,
    non_refundable: {
      service_fees: Math.round(serviceFeeTotal * 100) / 100,
      facility_fees: Math.round(nonRefundableFacilityFee * 100) / 100,
      penalty: penaltyAmount,
      processing_fee: order.processing_fee
    },
    order_status: order.status
  });
}
```

#### Validation Rules

| # | Condition | Status | Response |
|---|-----------|--------|----------|
| 1 | Order not found or not owned | 404 | `{"error": "order not found"}` |
| 2 | Order not confirmed/partially_refunded | 400 | `{"error": "order is not eligible for refund"}` |
| 3 | Within 24 hours of event | 400 | `{"error": "refunds not available within 24 hours of event"}` |
| 4 | Some tickets not eligible | 400 | `{"error": "some tickets are not eligible for refund"}` |
| 5 | No eligible tickets | 400 | `{"error": "no eligible tickets to refund"}` |

#### Response Format

```json
{
  "order_id": "ObjectId",
  "tickets_refunded": 2,
  "refund_tier": "75_percent",
  "refund_percentage": 75,
  "breakdown": {
    "base_ticket_total": 300.0,
    "penalty_amount": 75.0,
    "base_refund": 225.0,
    "facility_fee_refund": 0,
    "service_fee_refund": 0,
    "processing_fee_refund": 0
  },
  "total_refund": 225.0,
  "non_refundable": {
    "service_fees": 36.0,
    "facility_fees": 15.0,
    "penalty": 75.0,
    "processing_fee": 3.0
  },
  "order_status": "partially_refunded"
}
```

#### Test Cases (12)

| # | Category | Test Name | Description | Key Assertion |
|---|----------|-----------|-------------|---------------|
| 01 | Validation | `test_validation_01_order_not_found` | Non-existent order | Status 404 |
| 02 | Validation | `test_validation_02_not_owner` | Refund other user's order | Status 404 |
| 03 | Validation | `test_validation_03_already_refunded` | Refund already-refunded order | Status 400 |
| 04 | Validation | `test_validation_04_within_24_hours` | Event in 12 hours | Status 400, "within 24 hours" |
| 05 | Refund | `test_refund_05_full_refund_100pct_tier` | > 7 days, $200 base | `total_refund == 200`, `penalty == 0` |
| 06 | Refund | `test_refund_06_75pct_tier_correct_penalty` | 3-7 days, $200 base | `total_refund == 150`, `penalty == 50` |
| 07 | Refund | `test_refund_07_50pct_tier_correct_penalty` | 1-3 days, $200 base | `total_refund == 100`, `penalty == 100` |
| 08 | Refund | `test_refund_08_organizer_cancel_includes_facility_fee` | Event cancelled | `facility_fee_refund > 0`, `total_refund > base_refund` |
| 09 | Partial | `test_partial_09_specific_tickets_refunded` | 2 of 4 tickets | `tickets_refunded == 2`, `order_status == 'partially_refunded'` |
| 10 | Logic | `test_logic_10_section_sold_count_decremented` | Refund 3 tickets from section | `sold_count` decreased by 3 |
| 11 | Logic | `test_logic_11_full_order_refund_status` | Refund all tickets | `order_status == 'refunded'` |
| 12 | Response | `test_response_12_complete_breakdown` | Check response shape | `breakdown`, `non_refundable`, `total_refund` present with correct structure |

**Key test example (test 09 — partial refund):**

```javascript
it('test_partial_09_specific_tickets_refunded', async () => {
  const event = await createEvent({
    start_date: futureDate(10), status: 'on_sale'
  });
  const section = await createSection({
    event_id: event._id, capacity: 100, base_price: 100, sold_count: 4
  });
  const order = await createConfirmedOrder({
    event_id: event._id, user_id: user._id, quantity: 4,
    subtotal: 400, total_amount: 472
  });
  const tickets = await Ticket.find({ order_id: order._id, status: 'confirmed' });

  // Refund 2 of 4 tickets
  const res = await request(app)
    .post(`/api/v1/orders/${order._id}/refund`)
    .send({ ticket_ids: [tickets[0]._id.toString(), tickets[1]._id.toString()] })
    .set('Authorization', `Bearer ${token}`);

  expect(res.status).to.equal(200);
  expect(res.body.tickets_refunded).to.equal(2);
  expect(res.body.total_refund).to.equal(200); // 2 × $100 × 100%
  expect(res.body.order_status).to.equal('partially_refunded');

  const updatedSection = await Section.findById(section._id);
  expect(updatedSection.sold_count).to.equal(2); // 4 - 2

  const remaining = await Ticket.countDocuments({
    order_id: order._id, status: 'confirmed'
  });
  expect(remaining).to.equal(2);
});
```

#### Independence

Only touches `features/refund_processing/`. Reads order, ticket, event, and section data, but the refund logic is entirely self-contained. Doesn't interact with order creation, pricing engine, payment processing, cache, waitlist, or any bug code path.

---

---

## 7. Selection Guide

### Recommended Combinations

**Standard Assessment (3 bugs + 3 features, ~3-4 hours):**
- Bug 1 (Easy: Fee pipeline) + Bug 4 (Medium: Refund decomposition) + Bug 8 (Hard: Webhook security)
- Feature 1 (Seat Map) + Feature 3 (Waitlist) + Feature 5 (Dynamic Pricing Engine)

**Security Focus (for senior candidates, ~3-4 hours):**
- Bug 7 (Medium: Barcode forgery) + Bug 8 (Hard: Webhook verification) + Bug 10 (Hard: Transaction rollback)
- Feature 3 (Waitlist) + Feature 5 (Dynamic Pricing) + Feature 6 (Refund Processing)

**Full-Stack Assessment (5 bugs + 4 features, ~5-6 hours):**
- Bug 1 (Fee pipeline) + Bug 2 (State machine) + Bug 4 (Refund decomposition) + Bug 6 (Venue overlap) + Bug 9 (Cancellation cascade)
- Feature 1 + Feature 3 + Feature 4 + Feature 6

**Security + Business Logic (3 bugs + 2 features, ~2-3 hours):**
- Bug 7 (Medium: Barcode security) + Bug 5 (Medium: Transfer chain) + Bug 3 (Easy: Counter consistency)
- Feature 2 (Event Schedule) + Feature 4 (Ticket Transfer)

### Difficulty Distribution

| Difficulty | Bugs | Features | Total |
|------------|------|----------|-------|
| Easy | 3 (Bugs 1-3) | 2 (Features 1-2) | 5 |
| Medium | 4 (Bugs 4-7) | 2 (Features 3-4) | 6 |
| Hard | 3 (Bugs 8-10) | 2 (Features 5-6) | 5 |

### Independence Matrix

All 16 candidates (10 bugs + 6 features) are fully independent:
- Each bug touches a **different file or function** — no shared mutation paths
- Each feature lives in its own `features/` subdirectory with isolated routes and controllers
- Fixing one bug never fixes another; implementing one feature never implements another
- No shared state between any two candidates beyond read-only access to shared models
