# Test Review Findings

**Purpose:** Review each task's test file against the EVENT_TICKETING_SPEC.md and TASK_CREATION_RULES.md to identify gaps, hardcoded values, missing DB validations, and anti-cheat weaknesses.

---

## Task 1 — Order Total Pricing Pipeline

**Test file:** `test/task1/app.spec.js`
**Spec reference:** Bug 1 (Easy) — `EVENT_TICKETING_SPEC.md` lines 479–618
**Endpoint:** `POST /api/v1/orders`

### What the spec requires

- Dynamic pricing multiplier based on sell-through % (`sold_count / capacity`):
  - 0–49% → 1.0x (Standard)
  - 50–74% → 1.25x (High Demand)
  - 75–89% → 1.5x (Very High Demand)
  - 90–100% → 2.0x (Peak)
- Fee components: service fee (12%), facility fee (5%), processing fee ($3 flat)
- Promo code support: percentage discount and fixed discount (capped at subtotal)
- Response must include: `unit_price`, `multiplier`, `subtotal`, `service_fee_total`, `facility_fee_total`, `processing_fee`, `discount_amount`, `total_amount`
- Order must be persisted to DB with correct values

### Current test coverage (8 tests)

| # | Test | What it checks |
|---|------|----------------|
| 01 | Section not found | 404 status |
| 02 | Invalid quantity (0) | 400 status |
| 03 | Standard tier (10% sell-through, 1.0x) | All fee fields + total |
| 04 | Very high demand (80% sell-through, 1.5x) | unit_price, fees, total |
| 05 | Peak demand (95% sell-through, 2.0x) | unit_price, fees, total |
| 06 | Percentage promo (20%) | discount_amount, total |
| 07 | Fixed promo capped at subtotal | discount_amount, total |
| 08 | Response shape + DB persistence | All fields present + DB match |

### Findings

#### PASS — Things done well
- Tests cover all 4 demand tiers that are actually tested (standard, very_high, peak)
- Promo code tests cover both percentage and fixed-with-cap scenarios
- Test 08 does verify DB persistence and field matching
- Fee formula is validated with exact numeric assertions
- Each test creates its own section in `beforeEach` cleanup — good isolation

#### ISSUES FOUND

##### 1. MISSING: High Demand tier (1.25x at 50–74% sell-through) not tested
**Severity:** Medium
**Details:** The spec defines 4 tiers but the test only covers 3 (standard, very_high, peak). The **1.25x multiplier at 50–74% sell-through** is never tested. A candidate could hardcode multipliers for just the tested thresholds and skip the 1.25x tier entirely.
**Fix:** Add a test with `sold_count: 60, capacity: 100` (60% sell-through) and assert `unit_price == 125`.

##### 2. MISSING: DB validation only in test 08 — no DB checks for pricing correctness
**Severity:** High
**Details:** Tests 03–07 (the core pricing tests) only check `res.body`. They do NOT query the database. A candidate could return correct values in the HTTP response but store wrong values in MongoDB (e.g., store `base_price * quantity` in the DB while returning computed values in the response). Only test 08 checks the DB, and it uses a simple `$50 base / 0% sell-through` scenario — it doesn't verify dynamic pricing or promo discounts in the DB.
**Fix:** Add `Order.findOne()` assertions in tests 03–07, or add dedicated DB verification tests for each pricing tier and promo scenario. At minimum, verify `order.total_amount`, `order.unit_price`, `order.discount_amount` match in the DB for the high-demand and promo tests.

##### 3. HARDCODED: All tests use `base_price: 100` and `capacity: 100`
**Severity:** Medium
**Details:** Per TASK_CREATION_RULES.md Section 9.6 ("Test Anti-Cheat"): *"Test data MUST be generated dynamically (random values, computed expectations). Tests MUST NOT contain hardcoded expected values that can be reverse-engineered."* Every test uses `base_price: 100` and `capacity: 100`, making expected values trivially predictable. A candidate could hardcode `if (quantity == 2) return 237` etc.
**Fix:** Use dynamically generated values:
```javascript
const basePrice = 50 + Math.floor(Math.random() * 150); // 50-199
const capacity = 80 + Math.floor(Math.random() * 120);  // 80-199
```
Then compute expected values from these inputs in the test assertions.

##### 4. HARDCODED: Expected values are literal numbers, not computed from inputs
**Severity:** Medium
**Details:** Assertions like `expect(res.body.total_amount).to.equal(237)` use pre-computed constants. Per the anti-cheat rules, expected values should be computed dynamically:
```javascript
const expectedUnitPrice = basePrice * multiplier;
const expectedSubtotal = expectedUnitPrice * quantity;
// ... etc
expect(res.body.total_amount).to.equal(expectedTotal);
```
This prevents a candidate from just returning the hardcoded expected number.

##### 5. MISSING: Ticket creation not verified
**Severity:** Low
**Details:** When an order is created, tickets should be generated (one per quantity). No test verifies that `Ticket` documents are created with the correct `unit_price`, `service_fee`, and `facility_fee` per ticket. The spec mentions the Ticket model has `unit_price`, `service_fee`, `facility_fee` fields.
**Fix:** Add assertions like:
```javascript
const tickets = await Ticket.find({ order_id: order._id });
expect(tickets).to.have.lengthOf(quantity);
tickets.forEach(t => {
  expect(t.unit_price).to.equal(expectedUnitPrice);
  expect(t.service_fee).to.equal(expectedServiceFeePerTicket);
  expect(t.facility_fee).to.equal(expectedFacilityFeePerTicket);
});
```

##### 6. MISSING: Section `sold_count` / `held_count` update not verified
**Severity:** Low
**Details:** After an order is created, the section's `sold_count` or `held_count` should be incremented. No test verifies this side effect. (This may be intentionally left for Bug 3, but at minimum the order creation flow should verify the section counters are updated.)
**Fix:** If order creation is expected to update counters, add:
```javascript
const updatedSection = await Section.findById(section._id);
expect(updatedSection.held_count).to.equal(originalHeldCount + quantity);
```

##### 7. MISSING: Promo code `current_uses` increment not verified
**Severity:** Medium
**Details:** When a promo code is used in tests 06 and 07, the test doesn't verify that `promo.current_uses` was incremented in the database. A candidate could apply the discount without actually tracking usage, allowing unlimited use of limited promos.
**Fix:**
```javascript
const updatedPromo = await PromoCode.findById(promo._id);
expect(updatedPromo.current_uses).to.equal(1);
```

##### 8. MISSING: Invalid/expired promo code rejection not tested
**Severity:** Low
**Details:** No test sends an invalid promo code (non-existent code, expired code, or a code that has reached `max_uses`). The spec mentions `valid_from`, `valid_to`, `max_uses`, and `min_tickets` fields on PromoCode, but none of these validation paths are tested.
**Fix:** Add tests for:
- Non-existent promo code → should either ignore or return 400
- Expired promo code (`valid_to` in the past) → should reject
- Promo at max usage (`current_uses >= max_uses`) → should reject
- `min_tickets` not met → should reject

##### 9. MISSING: `multiplier` field value not asserted in pricing tests
**Severity:** Low
**Details:** Test 08 checks that `multiplier` exists as a property but none of the pricing tests (03–05) assert the actual `multiplier` value (e.g., `expect(res.body.multiplier).to.equal(1.5)`). A candidate could return `multiplier: "anything"` and still pass.
**Fix:** Add `expect(res.body.multiplier).to.equal(expectedMultiplier)` to tests 03, 04, and 05.

##### 10. MISSING: Negative quantity not tested
**Severity:** Low
**Details:** Test 02 checks `quantity: 0` but not negative quantities like `quantity: -1`. A candidate might only check `quantity === 0` and miss `quantity < 0`.
**Fix:** Add a test with `quantity: -1` expecting 400.

### Summary for Task 1

| Category | Count | Details |
|----------|-------|---------|
| Missing tier coverage | 1 | 1.25x (High Demand) tier not tested |
| Missing DB validation | 3 | Pricing tests don't check DB; ticket creation not verified; promo usage not verified |
| Hardcoded values (anti-cheat) | 2 | Static base_price/capacity; pre-computed expected values |
| Missing validation tests | 2 | Invalid/expired promo; negative quantity |
| Missing field assertions | 1 | `multiplier` value never asserted |
| Missing side-effect checks | 1 | Section counter updates |

**Verdict:** The test needs improvements before it's robust enough for a HackerRank assessment. The main concerns are (1) hardcoded values enabling cheating, (2) missing DB validation in pricing tests, and (3) the missing 1.25x tier that leaves a gap in the pricing logic coverage.

---

## Task 2 — Event Status State Machine

**Test file:** `test/task2/app.spec.js`
**Spec reference:** Bug 2 (Easy) — `EVENT_TICKETING_SPEC.md` lines 621–748
**Endpoint:** `PATCH /api/v1/events/:id/status`

### What the spec requires

**Valid transition map:**
```
draft      → [published]
published  → [on_sale, cancelled]
on_sale    → [sold_out, completed, cancelled]
sold_out   → [on_sale, completed, cancelled]
completed  → []  (terminal)
cancelled  → []  (terminal)
```

**Prerequisite checks:**
1. `→ published` requires at least 1 section
2. `sold_out → on_sale` requires available seats exist
3. `→ completed` requires `end_date` in the past

**Other requirements:**
- Only the organizer (`organizer_id`) can update the event status
- Non-existent event returns 404
- Invalid transitions return 400 with "cannot transition" message
- Prerequisite failures return 400 with specific message

### Current test coverage (8 tests)

| # | Test | What it checks |
|---|------|----------------|
| 01 | Event not found | 404 status |
| 02 | Not the organizer | 404 status |
| 03 | draft → published (with sections) | 200 + `status == 'published'` in response |
| 04 | draft → on_sale (invalid skip) | 400 + "cannot transition" |
| 05 | completed → on_sale (terminal) | 400 status only |
| 06 | cancelled → published (terminal) | 400 status only |
| 07 | draft → published without sections | 400 + "without sections" |
| 08 | on_sale → completed before end_date | 400 + "before its end date" |

### Findings

#### PASS — Things done well
- Tests cover both terminal states (completed, cancelled) as rejection cases
- Prerequisite checks tested: sections required for publish, end_date required for complete
- Organizer ownership check tested (test 02)
- Error messages are asserted in tests 04, 07, 08 — good for guiding candidates

#### ISSUES FOUND

##### 1. MISSING (HIGH): No DB verification after ANY transition
**Severity:** High
**Details:** The spec's own key test example explicitly checks the DB after a rejected transition:
```javascript
const updated = await Event.findById(event._id);
expect(updated.status).to.equal('draft'); // Status unchanged
```
None of the 8 tests query the database. Test 03 (the only success case) checks `res.body.event.status` but never verifies the DB was actually updated. Tests 04–08 (rejection cases) never verify the status remained **unchanged** in the DB. A candidate could:
- Return 200 with `{event: {status: 'published'}}` in the response but never call `.save()`
- Return 400 but still update the status in the DB before throwing
**Fix:** Add DB assertions to every test:
- Success tests: `const dbEvent = await Event.findById(event._id); expect(dbEvent.status).to.equal('published');`
- Rejection tests: `const dbEvent = await Event.findById(event._id); expect(dbEvent.status).to.equal('draft');` (unchanged)

##### 2. MISSING: Only 1 valid transition tested out of 9
**Severity:** High
**Details:** The spec defines 9 valid transitions but only `draft → published` is tested as a success path. None of these are tested:
- `published → on_sale` — the most common next step
- `published → cancelled`
- `on_sale → sold_out`
- `on_sale → completed` (with past end_date)
- `on_sale → cancelled`
- `sold_out → on_sale` (with available seats)
- `sold_out → completed`
- `sold_out → cancelled`

A candidate could hardcode `if (currentStatus === 'draft' && newStatus === 'published') allow()` and pass the only valid-transition test while rejecting everything else. The state machine would be incomplete.
**Fix:** Add at least 3–4 more valid transition tests covering different paths through the lifecycle (e.g., `published → on_sale`, `on_sale → cancelled`, `on_sale → completed` with past end_date).

##### 3. MISSING: Only 3 invalid transitions tested out of many
**Severity:** Medium
**Details:** Only 3 invalid transitions are tested: `draft → on_sale`, `completed → on_sale`, `cancelled → published`. Many important invalid transitions are not tested:
- `draft → completed` (skip to end)
- `draft → sold_out` (impossible state)
- `draft → cancelled` (skip published)
- `published → completed` (skip on_sale)
- `published → sold_out` (skip on_sale)
- `published → draft` (backwards)
- `on_sale → draft` (backwards)
- `on_sale → published` (backwards)

Without these, a candidate could allow backwards transitions or allow skipping states.
**Fix:** Add at least 2–3 more invalid transition tests, especially backwards transitions (`published → draft`, `on_sale → published`) and impossible jumps (`draft → sold_out`).

##### 4. MISSING: `sold_out → on_sale` prerequisite not tested
**Severity:** Medium
**Details:** The spec requires that `sold_out → on_sale` is only allowed when there are available seats. This prerequisite is never tested. A candidate could allow this transition without checking seat availability.
**Fix:** Add two tests:
- `sold_out → on_sale` with available seats → should succeed (200)
- `sold_out → on_sale` with NO available seats → should fail (400) with appropriate message

##### 5. MISSING: Completely invalid status value not tested
**Severity:** Low
**Details:** No test sends a nonsense status value like `{ status: 'banana' }` or `{ status: '' }` or missing status entirely. A candidate might only validate against the transition map and not handle completely invalid enum values.
**Fix:** Add a test with `status: 'invalid_status'` expecting 400.

##### 6. MISSING: Error message not asserted in tests 05 and 06
**Severity:** Low
**Details:** Tests 05 (completed → on_sale) and 06 (cancelled → published) only check status code `400` but don't verify the error message contains "cannot transition". Tests 04 does check the message. Without the message assertion, a candidate could return 400 for a different reason (e.g., validation error) and still pass.
**Fix:** Add `expect(res.body.error).to.include('cannot transition')` to tests 05 and 06.

##### 7. MISSING: Full lifecycle test (draft → published → on_sale → completed)
**Severity:** Medium
**Details:** No test walks through a complete event lifecycle to verify that the full chain of valid transitions works end-to-end. This is important because a candidate might implement individual transitions correctly but break when chaining them (e.g., the `.save()` after `draft → published` might not properly set up the state for `published → on_sale`).
**Fix:** Add a single test that chains transitions:
```javascript
// draft → published
await request(app).patch(`/events/${id}/status`).send({ status: 'published' });
// published → on_sale
await request(app).patch(`/events/${id}/status`).send({ status: 'on_sale' });
// on_sale → completed (with past end_date)
await request(app).patch(`/events/${id}/status`).send({ status: 'completed' });
// Verify final DB state
const dbEvent = await Event.findById(id);
expect(dbEvent.status).to.equal('completed');
```

##### 8. MISSING: Response structure not validated
**Severity:** Low
**Details:** Test 03 checks `res.body.event.status` but no test verifies the full response shape (e.g., that the response includes the event object with all expected fields like `title`, `venue_id`, `start_date`, etc.). The spec doesn't have a dedicated response structure test for this endpoint.
**Fix:** Add property checks for the success response to ensure the returned event object is complete.

### Summary for Task 2

| Category | Count | Details |
|----------|-------|---------|
| Missing DB validation | 1 | No test queries DB after any transition (success or rejection) |
| Missing valid transitions | 1 | Only 1 of 9 valid transitions tested |
| Missing invalid transitions | 1 | Only 3 invalid transitions tested; no backwards transitions |
| Missing prerequisite tests | 1 | `sold_out → on_sale` seat availability check not tested |
| Missing validation tests | 1 | Invalid/nonsense status values not tested |
| Missing error message assertions | 1 | Tests 05, 06 don't check error message |
| Missing lifecycle test | 1 | No end-to-end lifecycle chain test |
| Missing response structure | 1 | Success response shape not validated |

**Verdict:** This test has significant gaps. The most critical issues are (1) zero DB verification — a candidate can fake response values without persisting correctly, (2) only 1 valid transition tested out of 9 — the state machine is barely validated, and (3) the `sold_out → on_sale` prerequisite is completely untested. The test needs at minimum 4–5 additional tests to properly validate the state machine.

---

## Task 3 — Hold-to-Purchase Confirmation with Counter Transitions

**Test file:** `test/task3/app.spec.js`
**Spec reference:** Bug 3 (Easy) — `EVENT_TICKETING_SPEC.md` lines 751–868
**Endpoint:** `POST /api/v1/tickets/:id/confirm`

### What the spec requires

When a held ticket is confirmed, the fix must:
1. Validate ticket exists and is in `held` status (reject non-held tickets)
2. Decrement `section.held_count` by 1
3. Increment `section.sold_count` by 1
4. Delete the Redis hold key (`hold:{section_id}:{ticket_id}`)
5. Set `ticket.status = 'confirmed'` and `ticket.hold_expires_at = null`
6. Check if ALL sections for the event are sold out → if yes, set `event.status = 'sold_out'`

### Current test coverage (8 tests)

| # | Test | What it checks | DB verified? |
|---|------|----------------|-------------|
| 01 | Ticket not found | 404 status | No |
| 02 | Already confirmed ticket | 400 + "only held" message | No |
| 03 | held_count decremented | `section.held_count == 4` (was 5) | Yes |
| 04 | sold_count incremented | `section.sold_count == 51` (was 50) | Yes |
| 05 | Redis hold key removed | `redisClient.exists() == 0` | Yes (Redis) |
| 06 | Event → sold_out when last seat confirmed | `event.status == 'sold_out'` | Yes |
| 07 | Event stays on_sale when seats remain | `event.status == 'on_sale'` | Yes |
| 08 | Ticket fields updated | `ticket.status == 'confirmed'`, `hold_expires_at == null` | Yes |

### Findings

#### PASS — Things done well
- **DB verification is strong** — Tests 03, 04, 06, 07, 08 all query MongoDB directly to verify state changes. This is a significant improvement over Tasks 1 and 2.
- **Redis verification** — Test 05 checks Redis both before and after confirmation (proves the key existed and was removed).
- **Sold-out detection** — Both positive (test 06: last seat → sold_out) and negative (test 07: seats remain → stays on_sale) cases covered.
- **Counter transition checked separately** — held_count and sold_count verified in individual tests.
- **Good test isolation** — `beforeEach` cleans up and resets event status to `on_sale`.
- **Helper functions** — `createDummyOrder` and `createHeldTicket` keep tests clean and readable.

#### ISSUES FOUND

##### 1. HARDCODED: Counter values are static, not dynamic
**Severity:** Medium
**Details:** All tests use `sold_count: 50, held_count: 5` and assert `held_count == 4`, `sold_count == 51`. Per TASK_CREATION_RULES.md Section 9.6, values should be dynamically generated. A candidate could hardcode `section.held_count = originalHeldCount - 1` only for the specific input of 5.
**Fix:** Use random values and compute expected results:
```javascript
const initialHeld = 3 + Math.floor(Math.random() * 10);  // 3-12
const initialSold = 20 + Math.floor(Math.random() * 50); // 20-69
// ... later
expect(updatedSection.held_count).to.equal(initialHeld - 1);
expect(updatedSection.sold_count).to.equal(initialSold + 1);
```

##### 2. MISSING: Both counters not verified in the SAME test
**Severity:** Medium
**Details:** Test 03 only checks `held_count`, test 04 only checks `sold_count`. Neither test verifies BOTH counters together. A candidate could decrement `held_count` in one code path and increment `sold_count` in a different code path, or could do `held_count -= 1` without `sold_count += 1` and still pass one test. The spec's key test example checks both counters in a single test.
**Fix:** Either merge tests 03 and 04 into one test that asserts both, or add both assertions to each test:
```javascript
expect(updatedSection.held_count).to.equal(initialHeld - 1);
expect(updatedSection.sold_count).to.equal(initialSold + 1);
```

##### 3. MISSING: Confirming ticket for a different user (ownership check)
**Severity:** Medium
**Details:** No test verifies that User A cannot confirm User B's held ticket. All tests use the same user who created the ticket. A candidate could skip the ownership check entirely.
**Fix:** Add a test where a different user tries to confirm a ticket:
```javascript
const otherUser = await User.create({...});
const otherToken = generateToken(otherUser._id);
const res = await request.execute(app)
  .post(`/api/v1/tickets/${ticket._id}/confirm`)
  .set('Authorization', `Bearer ${otherToken}`);
expect(res).to.have.status(404); // or 403
```

##### 4. MISSING: Multiple sections sold-out check
**Severity:** Medium
**Details:** Test 06 only has ONE section with capacity 1. The spec's solution checks if ALL sections for the event are sold out before setting event to `sold_out`. No test verifies the multi-section scenario where one section is sold out but another still has availability — the event should stay `on_sale`.
**Fix:** Add a test with 2 sections: section A (capacity 1, gets sold out) and section B (capacity 100, still available). After confirming the last ticket in section A, event should stay `on_sale` because section B has seats.

##### 5. MISSING: Confirming other invalid statuses (cancelled, refunded, used)
**Severity:** Low
**Details:** Test 02 checks confirming an already `confirmed` ticket, but doesn't test other invalid statuses like `cancelled`, `refunded`, or `used`. A candidate might only check `if (status === 'confirmed') reject` rather than the correct `if (status !== 'held') reject`.
**Fix:** Add at least one test with `status: 'cancelled'` expecting 400 with "only held" message.

##### 6. MISSING: Redis hold key format not validated dynamically
**Severity:** Low
**Details:** The `createHeldTicket` helper hardcodes the Redis key format as `hold:${section._id}:${ticket._id}`. If the actual application uses a different key format, the test setup and verification would be misaligned. The key format is an implementation detail that should be derived from the system, not assumed by the test.
**Note:** This is a minor concern — the key format is defined in the spec, so it's acceptable to use it directly.

##### 7. MISSING: Response body structure not validated
**Severity:** Low
**Details:** Tests check `res.status === 200` but don't verify what's in the response body (e.g., whether it returns the updated ticket object). Test 08 checks the DB but not the response shape.
**Fix:** Add assertions on `res.body` to verify the response includes the ticket with updated status.

##### 8. MISSING: Expired hold ticket confirmation
**Severity:** Low
**Details:** No test checks what happens when confirming a ticket whose hold has expired (`hold_expires_at` in the past). The system might need to reject expired holds differently than active holds.
**Fix:** Add a test with `hold_expires_at: new Date(Date.now() - 60000)` (expired 1 minute ago) and define expected behavior.

### Summary for Task 3

| Category | Count | Details |
|----------|-------|---------|
| Hardcoded values (anti-cheat) | 1 | Static counter values; expected results pre-computed |
| Missing combined assertions | 1 | held_count and sold_count never checked together |
| Missing ownership check | 1 | No cross-user confirmation test |
| Missing multi-section sold-out | 1 | Only 1-section scenario tested for sold_out detection |
| Missing invalid status tests | 1 | Only `confirmed` tested, not `cancelled`/`refunded`/`used` |
| Missing response validation | 1 | Response body shape not checked |
| Missing edge cases | 1 | Expired hold confirmation not tested |

**Verdict:** This is the strongest test file so far — DB verification and Redis checks are well done. The main gaps are (1) hardcoded counter values, (2) counters checked separately instead of together, (3) no ownership/authorization check, and (4) multi-section sold-out scenario not tested. These are fixable with 3–4 additional tests.

---

## Task 4 — Refund with Tiered Penalties and Fee Decomposition

**Test file:** `test/task4/app.spec.js`
**Spec reference:** Bug 4 (Medium) — `EVENT_TICKETING_SPEC.md` lines 876–1049
**Endpoint:** `POST /api/v1/orders/:id/refund`

### What the spec requires

**Refund tiers (time-based):**
- Event >7 days away (>168 hours) → 100% of base price (`full_refund`)
- Event 3–7 days away (72–168 hours) → 75% of base price (`75_percent`)
- Event 1–3 days away (24–72 hours) → 50% of base price (`50_percent`)
- Event <24 hours away → refund rejected (400)
- Organizer cancellation (event.status === 'cancelled') → 100% base + facility fees

**Fee decomposition rules:**
- Base ticket price: refundable (with tier penalty)
- Service fees (12%): NEVER refunded
- Facility fees (5%): refunded ONLY on organizer cancellation
- Processing fee ($3): NEVER refunded

**Side effects:**
- Ticket statuses → `refunded`
- Section `sold_count` decremented by number of refunded tickets
- PromoCode `current_uses` decremented by 1 (if promo was used)
- Payment record created (type: `refund`)
- Order status → `refunded`

### Current test coverage (10 tests)

| # | Test | What it checks | DB verified? |
|---|------|----------------|-------------|
| 01 | Order not found | 404 status | No |
| 02 | Already refunded | 400 status | No |
| 03 | Event within 24 hours | 400 + "within 24 hours" | No |
| 04 | 100% tier (>7 days) | refund_amount, base_refund, fee_refunds, section.sold_count | Yes (Section) |
| 05 | 75% tier (3–7 days) | refund_amount, base_refund, tier, percentage | No |
| 06 | 50% tier (1–3 days) | refund_amount, base_refund, tier, percentage | No |
| 07 | Organizer cancellation (facility fee included) | refund_amount, base_refund, facility_fee_refund, service_fee_refund | No |
| 08 | Section sold_count restored | sold_count == 0 after refund of 3 tickets | Yes (Section) |
| 09 | Promo code usage decremented | current_uses decreased by 1 | Yes (PromoCode) |
| 10 | Response structure + DB state | All fields present + Payment record + Ticket statuses + Order status | Yes (Payment, Ticket, Order) |

### Findings

#### PASS — Things done well
- **All 4 refund tiers tested** — 100%, 75%, 50%, and <24 hours rejection are all covered
- **Organizer cancellation** tested separately with facility fee inclusion (test 07)
- **Fee decomposition validated** — tests 04 and 07 assert `service_fee_refund == 0`, `facility_fee_refund` values
- **Strong DB verification in test 10** — checks Payment record, Ticket statuses, and Order status in DB
- **Section sold_count restoration** tested (tests 04 and 08)
- **Promo code usage decrement** tested in DB (test 09)
- **Good helper functions** — `createConfirmedOrder` accepts dynamic `opts` for unit_price, service_fee, etc.
- **10 tests** — meets the "8-10 test cases" target for Medium difficulty

#### ISSUES FOUND

##### 1. HARDCODED: All tests use `unit_price: 100`, `service_fee: 12`, `facility_fee: 5`
**Severity:** Medium
**Details:** Every test uses the same values. A candidate could hardcode `refund_amount = 200` when they see 2 tickets at $100, rather than implementing the actual formula. Expected values should be computed from dynamic inputs.
**Fix:** Randomize `unit_price` and `ticketCount`, then compute expected values:
```javascript
const unitPrice = 75 + Math.floor(Math.random() * 100);
const ticketCount = 1 + Math.floor(Math.random() * 4);
const expectedBaseRefund = Math.round(unitPrice * ticketCount * refundPercentage * 100) / 100;
```

##### 2. MISSING: DB verification for refund amounts in tier tests (05, 06)
**Severity:** Medium
**Details:** Tests 05 (75% tier) and 06 (50% tier) only check `res.body` — they don't verify DB state. They don't check:
- Order status in DB → `refunded`
- Ticket statuses in DB → `refunded`
- Payment record created with correct amount
- Section sold_count restored

Test 04 checks section.sold_count but not Order/Ticket/Payment. Only test 10 does comprehensive DB checks, but with the 100% (>7 days) tier.
**Fix:** Add DB assertions to tests 05 and 06, or ensure test 10 covers at least one non-100% tier.

##### 3. MISSING: Organizer cancellation DB side effects not verified (test 07)
**Severity:** Medium
**Details:** Test 07 (organizer cancellation) validates the response amounts but doesn't check any DB state:
- Section sold_count not verified
- Ticket statuses not verified
- Order status not verified
- Payment record not verified
This is the most complex refund path and should have DB verification.
**Fix:** Add DB assertions to test 07 matching what test 10 does.

##### 4. MISSING: Ownership check — other user's order
**Severity:** Medium
**Details:** No test verifies that User A cannot refund User B's order. All tests use the same user. A candidate could skip the `user_id` filter in the query.
**Fix:** Add a test where a different user tries to refund the order:
```javascript
const otherUser = await User.create({...});
const otherToken = generateToken(otherUser._id);
const res = await request.execute(app)
  .post(`/api/v1/orders/${order._id}/refund`)
  .set('Authorization', `Bearer ${otherToken}`);
expect(res).to.have.status(404);
```

##### 5. MISSING: Refunding a `pending` or `cancelled` order not tested
**Severity:** Low
**Details:** Test 02 checks refunding an `already refunded` order, but doesn't test other invalid statuses. The spec says only `confirmed` and `partially_refunded` orders are eligible. No test checks:
- `pending` order → should be rejected
- `cancelled` order → should be rejected
**Fix:** Add at least one test with `status: 'pending'` expecting 400.

##### 6. MISSING: Processing fee explicitly asserted as 0 only in test 07
**Severity:** Low
**Details:** `processing_fee_refund == 0` is only asserted in test 07 (organizer cancellation). Tests 04, 05, 06 don't assert this. A candidate could refund the processing fee for non-organizer cancellations and still pass.
**Fix:** Add `expect(res.body.processing_fee_refund).to.equal(0)` to tests 04, 05, 06.

##### 7. MISSING: Boundary tier test — exactly 168 hours (7 days)
**Severity:** Low
**Details:** The spec's tiers have boundaries at 168 hours (7 days), 72 hours (3 days), and 24 hours. Tests use 10 days, 5 days, 36 hours, and 12 hours — all clearly within tiers. No test sits on a boundary (e.g., exactly 168 hours, exactly 72 hours, exactly 24 hours) to verify off-by-one correctness.
**Fix:** Add a test at exactly 168 hours (or 168 hours + 1 minute) to verify the boundary between 100% and 75%.

##### 8. MISSING: Refund when order has discount_amount > 0
**Severity:** Low
**Details:** Test 09 uses a promo code but the `createConfirmedOrder` helper always sets `discount_amount: 0`. No test verifies how the refund handles an order that had a discount applied. Does the refund return the discounted base price or the full base price? This edge case is untested.
**Fix:** Create an order with a non-zero `discount_amount` and verify the refund calculation accounts for it correctly.

### Summary for Task 4

| Category | Count | Details |
|----------|-------|---------|
| Hardcoded values (anti-cheat) | 1 | Static unit_price/service_fee/facility_fee across all tests |
| Missing DB validation | 2 | Tests 05, 06 only check response; test 07 no DB checks |
| Missing ownership check | 1 | No cross-user refund test |
| Missing invalid status tests | 1 | Only `refunded` rejected; not `pending`/`cancelled` |
| Missing fee assertions | 1 | `processing_fee_refund == 0` not asserted in most tier tests |
| Missing boundary tests | 1 | No tier boundary (168h, 72h, 24h) tests |
| Missing discount scenario | 1 | Orders with discount_amount > 0 not tested |

**Verdict:** Solid test with good coverage of all 4 tiers and strong DB checks in test 10. Main concerns are (1) hardcoded pricing values, (2) incomplete DB verification in the 75%/50%/organizer tier tests, and (3) no ownership check. The test needs 3–4 additions to be fully robust.

---

## Task 5 — Ticket Transfer with Ownership Chain

**Test file:** `test/task5/app.spec.js`
**Spec reference:** Bug 5 (Medium) — `EVENT_TICKETING_SPEC.md` lines 1052–1192
**Endpoint:** `POST /api/v1/tickets/:id/transfer`

### What the spec requires

**Validation chain:**
1. Ticket must exist and belong to the requesting user (ownership check)
2. Ticket must be in `confirmed` status
3. Event must not have started yet (`start_date > now`)
4. Recipient email must be provided and resolve to an existing user
5. Cannot transfer to yourself

**Transfer logic:**
1. Mark original ticket as `transferred` with `transferred_at` timestamp
2. Create a NEW ticket for the recipient with same pricing (`unit_price`, `service_fee`, `facility_fee`)
3. New ticket gets `status: 'confirmed'`, `user_id: recipient._id`
4. Preserve `original_user_id` from the original ticket (tracks the original purchaser)
5. Return `transfer_id`, `original_ticket_id`, `new_ticket_id`, `from_user`, `to_user`, `to_email`, `transferred_at`

### Current test coverage (9 tests)

| # | Test | What it checks | DB verified? |
|---|------|----------------|-------------|
| 01 | Ticket not found | 404 status | No |
| 02 | Not ticket owner (Bob tries Alice's ticket) | 404 status | No |
| 03 | Ticket not confirmed (refunded) | 400 + "only confirmed" | No |
| 04 | Event already started | 400 + "have started" | No |
| 05 | Recipient email not found | 404 + "recipient user not found" | No |
| 06 | Self-transfer blocked | 400 + "yourself" | No |
| 07 | Original ticket invalidated | `original.status == 'transferred'`, `transferred_at != null` | Yes |
| 08 | New ticket created for recipient | `newTicket.user_id == bob`, pricing preserved | Yes |
| 09 | original_user_id preserved | `newTicket.original_user_id == alice._id` | Yes |

### Findings

#### PASS — Things done well
- **All 6 validation checks from the spec are tested** (01–06) — ticket not found, ownership, status, event timing, recipient not found, self-transfer
- **Strong DB verification for transfer logic** (tests 07–09) — original ticket status, new ticket creation, pricing preservation, and original_user_id chain all verified via direct DB queries
- **Error messages asserted** in tests 03, 04, 05, 06 — guides candidates toward correct error messages
- **Two distinct users** (Alice and Bob) used properly for ownership and transfer testing
- **9 tests** — matches the spec's 9 test cases exactly

#### ISSUES FOUND

##### 1. MISSING: Validation tests don't verify DB unchanged after rejection
**Severity:** Medium
**Details:** Tests 02–06 (rejection cases) don't verify that the ticket's status remained `confirmed` in the database after the rejected transfer. A candidate could return 400 but still modify the ticket in the DB.
**Fix:** Add DB assertions to rejection tests:
```javascript
const unchangedTicket = await Ticket.findById(ticket._id);
expect(unchangedTicket.status).to.equal('confirmed'); // unchanged
```

##### 2. MISSING: Total ticket count not verified after transfer
**Severity:** Medium
**Details:** After a successful transfer, no test verifies the total number of tickets. The spec requires that a NEW ticket is created (not the original modified). A candidate could update the existing ticket's `user_id` instead of creating a new one and still pass test 08 if they also set the correct fields. Checking the total ticket count proves a new ticket was created:
```javascript
const totalTickets = await Ticket.countDocuments({ event_id: event._id });
expect(totalTickets).to.equal(2); // original (transferred) + new (confirmed)
```
**Fix:** Add a ticket count assertion in test 07 or 08.

##### 3. MISSING: Response structure not validated
**Severity:** Medium
**Details:** The spec defines the response should include `transfer_id`, `original_ticket_id`, `new_ticket_id`, `from_user`, `to_user`, `to_email`, `transferred_at`. No test checks the full response shape. Tests 08 and 09 use `res.body.new_ticket_id` but don't verify the other fields exist.
**Fix:** Add a test (or extend test 07) to check all response fields:
```javascript
expect(res.body).to.have.property('transfer_id');
expect(res.body).to.have.property('original_ticket_id');
expect(res.body).to.have.property('new_ticket_id');
expect(res.body).to.have.property('from_user');
expect(res.body).to.have.property('to_user');
expect(res.body).to.have.property('to_email');
expect(res.body).to.have.property('transferred_at');
```

##### 4. HARDCODED: All tickets use `unit_price: 100, service_fee: 12, facility_fee: 5`
**Severity:** Medium
**Details:** Per anti-cheat rules, values should be dynamic. A candidate could hardcode the pricing on the new ticket rather than copying from the original.
**Fix:** Use random pricing values and verify the new ticket matches:
```javascript
const unitPrice = 75 + Math.floor(Math.random() * 100);
// ... create ticket with unitPrice ...
expect(newTicket.unit_price).to.equal(unitPrice);
```

##### 5. MISSING: Transfer of already-transferred ticket not tested
**Severity:** Low
**Details:** Test 03 checks a `refunded` ticket but doesn't test transferring an already `transferred` ticket. This is an important edge case — after Alice transfers to Bob, Alice shouldn't be able to transfer the same ticket again.
**Fix:** Add a test that transfers a ticket, then tries to transfer the original again — should get 400 (not confirmed) or 404 (ownership changed).

##### 6. MISSING: Chain transfer (Bob transfers Alice's ticket to Charlie) not tested
**Severity:** Low
**Details:** Test 09 verifies `original_user_id` is preserved for a single transfer, but doesn't test a second-hop transfer where Bob transfers the new ticket to a third user (Charlie). The `original_user_id` should still be Alice through the chain.
**Fix:** Add a third user and test:
```javascript
// Alice → Bob, then Bob → Charlie
// Charlie's ticket should have original_user_id == Alice
```

##### 7. MISSING: Missing `to_email` field not tested
**Severity:** Low
**Details:** No test sends a request without the `to_email` field (or with an empty `to_email`). The spec says `if (!toEmail) throw new AppError('recipient email is required', 400)`.
**Fix:** Add a test with `send({})` (no `to_email`) expecting 400.

##### 8. CLEANUP: Test 04 manually deletes pastEvent
**Severity:** Low (code quality)
**Details:** Test 04 does `await Event.deleteOne({ _id: pastEvent._id })` at the end, which is manual cleanup that should be handled by `beforeEach`. If the test fails before this line, the event persists and could affect other tests. The `beforeEach` already cleans `Ticket` but not `Event` — the pastEvent created in test 04 won't be cleaned.
**Note:** Actually `beforeEach` only cleans `[Payment, Ticket]`, not Event. This is a potential test pollution issue if test 04 fails midway.

### Summary for Task 5

| Category | Count | Details |
|----------|-------|---------|
| Missing DB verification on rejections | 1 | Rejection tests don't verify ticket unchanged in DB |
| Missing ticket count verification | 1 | No check that a NEW ticket was created (not the original modified) |
| Missing response structure check | 1 | 7 response fields defined in spec, not validated |
| Hardcoded values (anti-cheat) | 1 | Static pricing values on all tickets |
| Missing edge cases | 3 | Already-transferred ticket, chain transfer, missing to_email |
| Test cleanup issue | 1 | Manual Event deletion in test 04 |

**Verdict:** Good validation coverage — all 6 spec validations are tested with proper error messages, and the core transfer logic has solid DB verification. Main gaps are (1) rejection tests don't verify DB unchanged, (2) no total ticket count check to prove a new ticket is created, (3) response structure not validated, and (4) hardcoded pricing values. Needs 2–3 additional tests.

---

## Task 6 — Venue Scheduling with Date Range Overlap Detection

**Test file:** `test/task6/app.spec.js`
**Spec reference:** Bug 6 (Medium) — `EVENT_TICKETING_SPEC.md` lines 1195–1324
**Endpoint:** `POST /api/v1/events` (venue conflict detection during event creation)

### What the spec requires

**Overlap detection formula:**
- `existingStart < bufferedEnd AND existingEnd > bufferedStart`
- Buffer period: 4 hours between events at the same venue

**Exclusion rules:**
- Cancelled events should NOT block venue availability
- Draft events should NOT block venue availability (spec: `$nin: ['cancelled', 'draft']`)
- Self-exclusion on update (current event's own dates don't conflict with itself)

**Conflict scenarios to detect:**
- New event falls inside multi-day event
- Partial overlap at start
- Partial overlap at end
- New event fully enclosed within existing
- Events too close (within 4-hour buffer)

**No-conflict scenarios:**
- Non-overlapping dates (well separated)
- Same dates but different venue
- Overlapping dates but existing event is cancelled

**Response on conflict:** 409 with `error: 'venue not available'` and `conflicts` array with event details

### Current test coverage (9 tests)

| # | Test | Type | What it checks | DB verified? |
|---|------|------|----------------|-------------|
| 01 | end_date before start_date | Validation | 400 status | No |
| 02 | Multi-day festival blocks middle date | Conflict | 409 + "venue not available" | No |
| 03 | Partial overlap at start | Conflict | 409 + "venue not available" | No |
| 04 | Partial overlap at end | Conflict | 409 + "venue not available" | No |
| 05 | Enclosed event (fully inside existing) | Conflict | 409 + "venue not available" | No |
| 06 | Within 4-hour buffer | Conflict | 409 + "venue not available" | No |
| 07 | Cancelled event ignored | No-conflict | 201 + event created | No (partially) |
| 08 | Non-overlapping dates | No-conflict | 201 + event created | No (partially) |
| 09 | Different venue same dates | No-conflict | 201 + event created | No (partially) |

### Findings

#### PASS — Things done well
- **All 4 overlap types tested** — middle, partial start, partial end, enclosed (tests 02–05)
- **Buffer period tested** (test 06) — 2-hour gap when 4-hour buffer required
- **Cancelled event exclusion** tested (test 07)
- **Different venue** no-conflict tested (test 09) — verifies conflict is per-venue
- **Non-overlapping dates** tested (test 08) — verifies events well apart are allowed
- **Error messages asserted** — "venue not available" checked in all conflict tests
- **Two venues** created as fixtures — enables the cross-venue test
- **Good date scenarios** — clear, well-commented date setups in each test

#### ISSUES FOUND

##### 1. MISSING: DB verification — no test checks that conflict events were NOT created
**Severity:** High
**Details:** Tests 02–06 (conflict cases) only check `res.status === 409`. They don't verify that the conflicting event was NOT persisted to the database. A candidate could detect the conflict, return 409, but still save the event to MongoDB.
**Fix:** Add DB assertion to conflict tests:
```javascript
const eventCount = await Event.countDocuments({ title: 'Mid-Festival Concert' });
expect(eventCount).to.equal(0); // Event should not have been created
```

##### 2. MISSING: DB verification — no test checks that successful events ARE persisted
**Severity:** Medium
**Details:** Tests 07–09 (no-conflict, 201 cases) check `res.body.event.title` but never query the DB to verify the event was actually saved. They rely entirely on the response body.
**Fix:** Add DB assertion to success tests:
```javascript
const dbEvent = await Event.findOne({ title: 'Replacement Concert' });
expect(dbEvent).to.not.be.null;
expect(dbEvent.venue_id.toString()).to.equal(venue._id.toString());
```

##### 3. MISSING: `conflicts` array not validated in conflict responses
**Severity:** Medium
**Details:** The spec's key test example asserts `expect(res.body.conflicts).to.have.lengthOf(1)` and the solution returns conflict details (event_id, title, start_date, end_date). No test in the file checks `res.body.conflicts` at all — only the error message is checked. A candidate could return `{ error: 'venue not available' }` without including the conflict details.
**Fix:** Add conflict detail assertions:
```javascript
expect(res.body).to.have.property('conflicts');
expect(res.body.conflicts).to.be.an('array').with.lengthOf(1);
expect(res.body.conflicts[0]).to.have.property('title', 'Summer Festival');
```

##### 4. MISSING: Spec test 08 — self-exclusion on update not tested
**Severity:** Medium
**Details:** The spec defines test 08 as `test_exclusion_08_self_exclusion_on_update` — when updating an existing event's dates, the event's own record should be excluded from the conflict check. This test is completely missing. Instead, the test file uses test 08 for "non-overlapping dates" and test 09 for "different venues". The self-exclusion test is critical for update operations.
**Fix:** Add a test that updates an existing event and verifies it doesn't conflict with itself:
```javascript
// Create event, then update its dates — should not conflict with itself
const event = await Event.create({ venue_id: venue._id, start_date: ..., end_date: ... });
const res = await request.execute(app)
  .put(`/api/v1/events/${event._id}`)
  .send({ start_date: newDate, end_date: newDate });
expect(res).to.have.status(200);
```

##### 5. MISSING: Draft events exclusion not tested
**Severity:** Low
**Details:** The spec solution excludes both `cancelled` and `draft` events from conflict checks (`$nin: ['cancelled', 'draft']`). Test 07 covers cancelled exclusion but no test covers draft event exclusion. A candidate could only exclude cancelled events and miss draft.
**Fix:** Add a test with a `draft` event at the same venue/dates, then create a new event — should succeed (201).

##### 6. MISSING: Buffer period — no test for "just outside buffer" (should succeed)
**Severity:** Low
**Details:** Test 06 checks that a 2-hour gap fails (within 4-hour buffer). But there's no test for events that are exactly at or just outside the buffer (e.g., 5-hour gap) to verify they're allowed. Without this, a candidate could set a very large buffer and still pass.
**Fix:** Add a test where events have a 5-hour gap (just outside 4-hour buffer) and verify it succeeds (201).

##### 7. MISSING: Exact same time range (complete overlap) not tested
**Severity:** Low
**Details:** The overlap tests cover partial overlaps and enclosed events, but not the simplest case: an event with the exact same start_date and end_date as the existing one. This is the most basic overlap case.
**Fix:** Add a test creating an event with identical dates at the same venue, expecting 409.

##### 8. MISSING: Error message for end_date validation not asserted (test 01)
**Severity:** Low
**Details:** Test 01 checks `res.status === 400` but doesn't assert the error message (spec says "must be after"). A candidate could return 400 for a different reason.
**Fix:** Add `expect(res.body.error).to.include('must be after')` or similar.

### Summary for Task 6

| Category | Count | Details |
|----------|-------|---------|
| Missing DB verification | 2 | Conflict events not checked for non-creation; success events not verified in DB |
| Missing conflict detail validation | 1 | `conflicts` array never asserted in any test |
| Missing spec test (self-exclusion) | 1 | Self-exclusion on update (spec test 08) completely missing |
| Missing exclusion tests | 1 | Draft event exclusion not tested |
| Missing buffer boundary test | 1 | No "just outside buffer" success test |
| Missing basic overlap test | 1 | Exact same dates not tested |
| Missing error message assertion | 1 | Test 01 doesn't check error message |

**Verdict:** Good overlap scenario coverage — all 4 overlap types and the buffer are tested. Main concerns are (1) zero DB verification in any test, (2) `conflicts` response array never validated, (3) the spec's self-exclusion test is missing entirely, and (4) draft event exclusion not tested. Needs 3–4 additions to be robust.

---

## Task 7 — Ticket Barcode Security with HMAC Signing

**Test file:** `test/task7/app.spec.js`
**Spec reference:** Bug 7 (Medium) — `EVENT_TICKETING_SPEC.md` lines 1330–1488
**Endpoints:** `POST /api/v1/tickets/:id/barcode` (generate) and `POST /api/v1/tickets/verify-barcode` (verify)

### What the spec requires

**Barcode generation:**
- HMAC-SHA256 signature using server secret
- Payload contains `tid` (ticket ID), `uid` (user ID), `eid` (event ID), `iat` (issued at)
- Format: `base64url(payload).base64url(signature)` (two parts separated by `.`)
- Different tickets produce different barcodes

**Barcode verification:**
1. Check format (must have exactly 2 parts split by `.`)
2. Verify HMAC signature (reject tampered payloads)
3. Verify ticket exists and is `confirmed`
4. Verify ownership binding (`ticket.user_id` matches `payload.uid`)
5. Track scan count — increment `scan_count`, set `last_scanned_at`
6. Return `warning: 'duplicate_scan_detected'` when `scan_count > 1`

**Security requirements:**
- Forged barcodes (tampered payload + old signature) must be rejected
- Plain base64 ticket IDs (no signature) must be rejected
- Ownership mismatch must be detected
- Cancelled/refunded tickets must be rejected on verification

### Current test coverage (8 tests)

| # | Test | Type | What it checks | DB verified? |
|---|------|------|----------------|-------------|
| 01 | Forged barcode (tampered payload) | Security | `valid == false`, "invalid signature" | No |
| 02 | Plain base64 ID (no signature) | Security | `valid == false`, "invalid barcode format" | No |
| 03 | Ownership mismatch | Security | `valid == false`, "ownership mismatch" | No |
| 04 | Barcode has dot separator (2 parts) | Generate | `.split('.')` has length 2 | No |
| 05 | Different tickets → different barcodes | Generate | `barcode1 !== barcode2` | No |
| 06 | Valid barcode verified successfully | Verify | `valid == true`, correct `ticket_id` | No |
| 07 | Duplicate scan detection | Scan | `scan_count == 2`, `warning == 'duplicate_scan_detected'` | No |
| 08 | Cancelled ticket rejected | Verify | `valid == false`, "not confirmed" | No |

### Findings

#### PASS — Things done well
- **All 3 security attack vectors tested** — forged barcode (test 01), plain base64 bypass (test 02), ownership mismatch (test 03)
- **Sophisticated test 01** — actually generates a legit barcode, extracts payload, tampers with it, and re-submits. This is a well-designed security test.
- **Duplicate scan tracking** tested (test 07) — both `scan_count` and `warning` field checked
- **Cancelled ticket** rejection tested (test 08)
- **Barcode format** validated (test 04) and uniqueness checked (test 05)
- **Two users** (Alice/Bob) set up for ownership tests
- **Tests match spec's 8 test cases exactly**
- **Non-trivial pricing** — uses `base_price: 79` instead of round numbers (mild anti-cheat)

#### ISSUES FOUND

##### 1. MISSING (HIGH): No DB verification for scan_count persistence
**Severity:** High
**Details:** Test 07 checks `verifyRes2.body.scan_count == 2` in the response but never queries the DB to verify `ticket.scan_count` was actually persisted. The spec solution does `ticket.scan_count = (ticket.scan_count || 0) + 1; await ticket.save()`. A candidate could return `scan_count: 2` in the response without saving to MongoDB.
**Fix:** Add DB assertion:
```javascript
const dbTicket = await Ticket.findById(ticket1._id);
expect(dbTicket.scan_count).to.equal(2);
expect(dbTicket.last_scanned_at).to.not.be.null;
```

##### 2. MISSING: `last_scanned_at` timestamp not verified
**Severity:** Medium
**Details:** The spec solution sets `ticket.last_scanned_at = new Date()` on every scan. No test verifies this field exists, either in the response or in the DB. A candidate could skip this entirely.
**Fix:** Add to test 06 or 07:
```javascript
const dbTicket = await Ticket.findById(ticket1._id);
expect(dbTicket.last_scanned_at).to.be.a('date');
```

##### 3. MISSING: Barcode generation ownership check not tested
**Severity:** Medium
**Details:** No test verifies that Bob cannot generate a barcode for Alice's ticket. The generate endpoint (`POST /api/v1/tickets/:id/barcode`) should only work for the ticket owner. All generation tests use Alice generating barcodes for her own tickets.
**Fix:** Add a test where Bob tries to generate a barcode for Alice's ticket:
```javascript
const res = await request.execute(app)
  .post(`/api/v1/tickets/${ticket1._id}/barcode`)
  .set('Authorization', `Bearer ${bobToken}`);
expect(res).to.have.status(404); // or 403
```

##### 4. MISSING: Verify response payload fields not validated
**Severity:** Medium
**Details:** Test 06 checks `valid == true` and `ticket_id` but doesn't verify the other response fields from the spec: `user_id`, `event_id`, `scan_count`. The spec solution returns all these fields on successful verification.
**Fix:** Extend test 06:
```javascript
expect(verifyRes.body).to.have.property('user_id');
expect(verifyRes.body).to.have.property('event_id');
expect(verifyRes.body).to.have.property('scan_count', 1);
expect(verifyRes.body.warning).to.be.null; // first scan, no warning
```

##### 5. MISSING: `ticket.barcode` field persistence not verified
**Severity:** Low
**Details:** When a barcode is generated, it's unclear if the barcode is stored on the ticket record in the DB. No test checks whether `ticket.barcode` is saved after generation. If the barcode needs to be regenerated or compared later, this matters.
**Fix:** After barcode generation, check DB:
```javascript
const dbTicket = await Ticket.findById(ticket1._id);
expect(dbTicket.barcode).to.be.a('string');
expect(dbTicket.barcode).to.equal(genRes.body.barcode);
```

##### 6. MISSING: Generating barcode for non-confirmed ticket not tested
**Severity:** Low
**Details:** No test attempts to generate a barcode for a `held`, `cancelled`, or `refunded` ticket. Only verification rejects non-confirmed tickets (test 08). The generation endpoint should also reject non-confirmed tickets.
**Fix:** Add a test creating a ticket with `status: 'held'` and attempting barcode generation — should fail.

##### 7. MISSING: Empty/missing barcode field in verify request not tested
**Severity:** Low
**Details:** No test sends `{ barcode: '' }` or `{}` to the verify endpoint. A candidate might not handle missing input.
**Fix:** Add test: `send({})` → expect error response.

##### 8. MISSING: HMAC uses timing-safe comparison — not verifiable by test but worth noting
**Severity:** Informational
**Details:** The spec solution uses `crypto.timingSafeEqual()` for signature comparison to prevent timing attacks. This is correct but not testable through HTTP — just noted for code review.

### Summary for Task 7

| Category | Count | Details |
|----------|-------|---------|
| Missing DB verification | 1 | scan_count not verified in DB after scans |
| Missing timestamp verification | 1 | `last_scanned_at` never checked |
| Missing generation ownership check | 1 | Bob can't generate barcode for Alice's ticket — untested |
| Missing response field validation | 1 | Verify response missing `user_id`, `event_id`, `scan_count` checks |
| Missing barcode persistence check | 1 | Not verified if barcode stored on ticket record |
| Missing edge cases | 2 | Generate for non-confirmed ticket; empty barcode input |

**Verdict:** Excellent security testing — the forged barcode test (01) is sophisticated and well-designed. All spec test cases are covered. Main gaps are (1) no DB verification for scan tracking, (2) `last_scanned_at` never checked, (3) no generation ownership check (Bob generating for Alice's ticket), and (4) verify response fields incomplete. Needs 2–3 additions.

---

## Task 8 — Payment Webhook Handler Security

**Test file:** `test/task8/app.spec.js`
**Spec reference:** Bug 8 (Hard) — `EVENT_TICKETING_SPEC.md` lines 1491–1648
**Endpoint:** `POST /api/v1/payments/webhook`

### What the spec requires

**Signature verification:**
1. `x-webhook-signature` header required (401 if missing)
2. HMAC-SHA256 of request body using `PAYMENT_WEBHOOK_SECRET`
3. Timing-safe comparison (reject forged/tampered)

**Amount matching:**
4. Webhook `amount` must match `order.total_amount` (400 if mismatch)

**Idempotency:**
5. `webhook_event_id` tracked via `WebhookLog` model
6. Duplicate webhooks return `{ received: true, duplicate: true }` without re-processing

**Status state machine:**
7. Valid transitions: `pending → [processing, completed, failed]`, `processing → [completed, failed]`, `completed → []`, `failed → [processing]`
8. Invalid transitions return `{ received: true, ignored: true }`

**Fulfillment on success:**
9. `completed` payment → order status `confirmed`, payment_status `paid`, all held tickets → `confirmed`
10. `failed` payment → order payment_status `failed`

**Logging:**
11. WebhookLog entry created for each webhook event

### Current test coverage (10 tests)

| # | Test | Type | What it checks | DB verified? |
|---|------|------|----------------|-------------|
| 01 | Missing signature header | Security | 401 + "missing webhook signature" | No |
| 02 | Invalid signature | Security | 401 + "invalid webhook signature" | No |
| 03 | Tampered body (signed original, sent different) | Security | 401 status | No |
| 04 | Amount mismatch | Amount | 400 + "amount does not match" | No |
| 05 | Duplicate webhook (same event_id) | Idempotency | 2nd call: `duplicate == true` | No |
| 06 | Valid payment completion | State | `payment_status == 'completed'`, order confirmed + paid | Yes (Order) |
| 07 | Invalid transition (completed → pending) | State | `ignored == true` | No |
| 08 | Held tickets confirmed on payment success | Fulfillment | All 3 tickets → `confirmed` | Yes (Ticket) |
| 09 | Failed payment updates order | Failure | `order.payment_status == 'failed'` | Yes (Order) |
| 10 | WebhookLog entry created | Logging | WebhookLog exists with correct fields | Yes (WebhookLog) |

### Findings

#### PASS — Things done well
- **All 3 signature attack vectors tested** — missing header (01), wrong signature (02), tampered body (03). Excellent security coverage.
- **`signWebhook` helper** correctly uses the same HMAC approach as the spec, making tests realistic
- **Idempotency tested** (test 05) — sends same webhook twice, verifies duplicate detection
- **Strong DB verification** — test 06 checks Order status, test 08 checks all 3 Ticket statuses, test 09 checks Order payment_status, test 10 checks WebhookLog
- **Amount mismatch** tested (test 04) with a proper payment + order setup
- **Status state machine** tested — both valid transition (06) and invalid transition (07)
- **Ticket fulfillment** tested with 3 held tickets (test 08)
- **Failed payment path** tested (test 09)
- **10 tests** — matches the spec's 10 test cases exactly and meets the Hard difficulty target
- **WebhookLog import and cleanup** properly handled

#### ISSUES FOUND

##### 1. MISSING: Payment record status not verified in DB after webhook
**Severity:** Medium
**Details:** Test 06 verifies `Order` status in DB but doesn't verify that the `Payment` record itself was updated (`payment.status == 'completed'`, `payment.processed_at != null`). A candidate could update the order but forget to update the payment record.
**Fix:** Add to test 06:
```javascript
const updatedPayment = await Payment.findById(payment._id);
expect(updatedPayment.status).to.equal('completed');
expect(updatedPayment.processed_at).to.not.be.null;
```

##### 2. MISSING: Idempotency — DB state not verified after duplicate
**Severity:** Medium
**Details:** Test 05 checks the response for `duplicate: true` but doesn't verify that:
- The payment was only processed ONCE (payment status, order status checked after 2nd call)
- Only ONE WebhookLog entry exists (not two)
A candidate could process the payment twice and just return `duplicate: true` on the second call.
**Fix:** Add after the second webhook call:
```javascript
const logCount = await WebhookLog.countDocuments({ webhook_event_id: webhookEventId });
expect(logCount).to.equal(1); // Only one log entry, not two
const updatedOrder = await Order.findById(order._id);
expect(updatedOrder.status).to.equal('confirmed'); // Still confirmed, not double-processed
```

##### 3. MISSING: Invalid transition — DB state not verified unchanged
**Severity:** Medium
**Details:** Test 07 (completed → pending) checks `res.body.ignored == true` but doesn't verify that the payment and order records remain unchanged in the DB. A candidate could return `ignored: true` but still update the DB.
**Fix:** Add:
```javascript
const unchangedPayment = await Payment.findById(payment._id);
expect(unchangedPayment.status).to.equal('completed'); // Unchanged
const unchangedOrder = await Order.findById(order._id);
expect(unchangedOrder.payment_status).to.equal('paid'); // Unchanged
```

##### 4. MISSING: Security rejection tests — DB state not verified
**Severity:** Medium
**Details:** Tests 01–04 (rejection cases) don't verify that no Payment, Order, or WebhookLog records were modified. A candidate could reject with the correct status code but still process the webhook partially.
**Fix:** For test 04 (amount mismatch), add:
```javascript
const unchangedPayment = await Payment.findById(payment._id);
expect(unchangedPayment.status).to.equal('pending'); // Not updated
```

##### 5. HARDCODED: All amounts use `237`
**Severity:** Low
**Details:** Every test uses `total_amount: 237` and `amount: 237`. While less exploitable than pricing tests (since the webhook logic is about matching, not calculating), dynamic values would be more robust.
**Fix:** Use randomized amounts:
```javascript
const orderAmount = 100 + Math.floor(Math.random() * 400);
```

##### 6. MISSING: Payment not found scenario not tested
**Severity:** Low
**Details:** The spec's buggy code handles `payment not found` with a 404. No test sends a valid signed webhook with a non-existent `payment_id`. Test 01 sends without a signature, so it fails before reaching the payment lookup.
**Fix:** Add a test with a valid signature but fake `payment_id` — should return 404.

##### 7. MISSING: `failed → processing` retry transition not tested
**Severity:** Low
**Details:** The spec's state machine allows `failed → [processing]` (retry after failure). No test covers this valid transition. Only `pending → completed` is tested as a success path.
**Fix:** Add a test: create a `failed` payment, send webhook with `status: 'processing'`, verify it's accepted.

##### 8. MISSING: Tampered body test doesn't check error message
**Severity:** Low
**Details:** Test 03 (tampered body) only checks `res.status == 401` but not the error message. Tests 01 and 02 check messages but 03 doesn't. A candidate could return 401 for a different reason.
**Fix:** Add `expect(res.body.error).to.match(/invalid webhook signature/i)`.

### Summary for Task 8

| Category | Count | Details |
|----------|-------|---------|
| Missing DB verification (payments) | 1 | Payment record status/processed_at not checked after webhook |
| Missing DB verification (idempotency) | 1 | WebhookLog count and order state not verified after duplicate |
| Missing DB verification (rejections) | 2 | Invalid transition and security rejections don't verify DB unchanged |
| Hardcoded amounts | 1 | All tests use `237` |
| Missing scenarios | 2 | Payment not found; `failed → processing` retry |
| Missing error message | 1 | Test 03 doesn't check error message |

**Verdict:** This is one of the strongest test files — excellent security coverage, proper signature testing, idempotency, ticket fulfillment, and WebhookLog verification. The main gaps are DB verification on rejection/duplicate paths (ensuring nothing was modified when it shouldn't have been). Needs 2–3 additions to be fully robust.

---

## Task 9 — Event Cancellation with Bulk Refund Cascade

**Test file:** `test/task9/app.spec.js`
**Spec reference:** Bug 9 (Hard) — `EVENT_TICKETING_SPEC.md` lines 1692–1901
**Endpoint:** `PATCH /api/v1/events/:id/status` (with `{ status: 'cancelled' }`)

### What the spec requires

- Only the event organizer can cancel; non-organizer gets 404
- Events with status `completed` or `cancelled` cannot be cancelled (400)
- Find all active orders (`confirmed`, `partially_refunded`) for the event
- For each order: calculate organizer-cancellation refund = 100% base price + facility fees
- Create refund `Payment` records (`type: 'refund'`, `status: 'completed'`)
- Update all confirmed tickets to `cancelled`
- Update order status to `refunded`, payment_status to `refunded`
- Decrement promo code `current_uses` for orders that used a promo
- Cancel held tickets and clean up Redis hold keys (`hold:{sectionId}:{ticketId}`)
- Reset all section counters (`sold_count: 0`, `held_count: 0`)
- Handle partial failures (per-order try/catch, continue processing others)
- Return cascade summary: `event_id`, `status`, `orders_processed`, `refunds[]`, `held_tickets_cancelled`

### Current test coverage (11 tests)

| # | Test | What it checks | DB/Redis verified? |
|---|------|----------------|--------------------|
| 01 | Event not found | 404 status | No |
| 02 | Not organizer | 404 status | No |
| 03 | Already cancelled | 400 status | No |
| 04 | Refund all confirmed orders | Response: orders_processed=3, refunds.length=3, status=success | No |
| 05 | Refund = base + facility | Response: refund_amount=210 | No |
| 06 | All tickets cancelled | DB: all 6 tickets status=cancelled | **Yes** |
| 07 | Section counters reset | DB: sold_count=0, held_count=0 | **Yes** |
| 08 | Promo usage decremented | DB: current_uses 5→3 | **Yes** |
| 09 | Redis hold keys cleaned | Redis: keys deleted (before/after check) | **Yes (Redis)** |
| 10 | No orders edge case | Response: orders_processed=0, refunds=[] | No |
| 11 | Complete cascade summary | Response: all fields + refund entry structure | No |

### Findings

**PASS (strong points):**
- Tests 06–09 all verify DB/Redis state directly — excellent
- Test 09 uses a proper before/after Redis existence check pattern
- Test 08 correctly sets up `current_uses: 5`, 2 promo orders, then expects `current_uses: 3`
- Test 04 creates multiple orders with dynamic idempotency keys (includes `Date.now()`)
- Test 11 validates both high-level and per-refund response structure

**ISSUES:**

1. **CRITICAL — Missing: Partial failure handling (Spec Test #10)**
   - Spec requires `test_partial_10_continues_after_single_failure` — 3 orders, 1 fails mid-refund, 2 succeed + 1 failed
   - No test simulates partial failure. This validates the per-order try/catch pattern which is central to the bug's cascade design.

2. **HIGH — Missing: Refund Payment records never verified in DB**
   - Spec solution creates `Payment.create({ type: 'refund', status: 'completed' })` per order
   - Spec's key test example explicitly checks: `Payment.find({ type: 'refund' })` with expected count
   - None of the 11 tests query `Payment` collection after cancellation

3. **HIGH — Missing: Order status/payment_status not verified after cancellation**
   - Spec solution sets `order.status = 'refunded'` and `order.payment_status = 'refunded'`
   - No test queries `Order` documents after cancellation to verify status changes
   - A candidate could skip order updates and still pass all tests

4. **HIGH — Hardcoded pricing in Tests 04–06, 08, 11**
   - All use `base_price: 100`, `unit_price: 100`, `service_fee: 12`, `facility_fee: 5`
   - Tests 05 and 11 expect hardcoded `refund_amount: 210` — candidate can hardcode this value
   - Should use dynamic/random base_price + facility_fee with computed expected refund

5. **MEDIUM — Missing: "completed" event rejection**
   - Spec solution checks `['completed', 'cancelled'].includes(event.status)` → 400
   - Only "already cancelled" is tested (Test 03); no test creates an event with `status: 'completed'` and attempts cancellation

6. **MEDIUM — Test 02 doesn't verify event unchanged in DB**
   - After rejecting a non-organizer, should verify `event.status` is still `'on_sale'` via DB query

7. **MEDIUM — Test 03 doesn't check error message content**
   - Spec says error should include "cannot cancel" but test only asserts `status(400)`
   - Candidate can return any 400 error for any reason

8. **MEDIUM — Test 09: Held tickets DB status not verified**
   - Test verifies Redis keys are cleaned but doesn't check that held tickets' status changed to `'cancelled'` in MongoDB
   - Spec solution does: `Ticket.updateMany({ event_id, status: 'held' }, { status: 'cancelled' })`

9. **LOW — Test 07: Only single section tested**
   - Spec uses `Section.updateMany({ event_id })` to reset all sections
   - Should test with 2+ sections to ensure ALL are reset, not just one

10. **LOW — Test 10 (no orders): Event status not verified in DB**
    - Should query `Event.findById()` to confirm `status: 'cancelled'` even with zero orders

### Summary

| Issue Type | Count | Details |
|-----------|-------|---------|
| Missing spec test case | 1 | Partial failure handling (spec test #10) |
| Missing DB verification | 3 | Payment records, order status updates, held ticket status |
| Hardcoded values | 1 | All pricing uses base_price:100, facility_fee:5, expects 210 |
| Missing status validation | 1 | "completed" event rejection not tested |
| Missing error message check | 1 | Test 03 only checks status code |
| Missing DB-unchanged check | 1 | Test 02 rejection path |
| Insufficient coverage | 2 | Single section counter reset, no-orders event status |

**Verdict:** Good DB/Redis verification in tests 06–09 (strongest area), but significant gaps remain. The missing partial-failure test is critical since it's the spec's differentiating feature for this Hard-level task. No test verifies Payment record creation or Order status changes — two core cascade operations. Hardcoded pricing enables stub cheating. Needs 5–6 additions and pricing randomization to be fully robust.

---

## Task 10 — Multi-Section Order with Transaction Rollback

**Test file:** `test/task10/app.spec.js`
**Spec reference:** Bug 10 (Hard) — `EVENT_TICKETING_SPEC.md` lines 1905–2121
**Endpoint:** `POST /api/v1/orders` (with `sections[]` array for multi-section)

### What the spec requires

- Event must exist and be `on_sale`; otherwise 404
- Accept `sections` array: `[{ section_id, quantity }, ...]`
- For each section: atomic check-and-reserve within a MongoDB transaction
- If any section has insufficient capacity, abort entire transaction (all-or-nothing)
- On failure: no orphaned tickets, no orphaned Redis holds, no changed held_count on ANY section
- On success: all sections' `held_count` incremented, tickets created with `held` status, Redis holds set, Order created
- Concurrent orders for last seats: only one succeeds (TOCTOU prevention via transaction)
- Response must include order with all tickets and correct total quantity

### Current test coverage (10 tests)

| # | Test | What it checks | DB/Redis verified? |
|---|------|----------------|--------------------|
| 01 | Event not found | 404 status | No |
| 02 | Event not on sale (draft) | 404 status | No |
| 03 | Multi-section order success | Response: 201, quantity=5, tickets.length=5, total_amount | No |
| 04 | Rollback first section on second fail | DB: VIP held_count=0 (rolled back) | **Yes** |
| 05 | No orphaned tickets on failure | DB: Ticket.countDocuments=0 | **Yes** |
| 06 | No orphaned Redis holds on failure | Redis: keys pattern returns empty | **Yes (Redis)** |
| 07 | held_count correct after success | DB: VIP held_count=3, Orchestra held_count=2 | **Yes** |
| 08 | held_count unchanged on failure | DB: both sections held_count=0 | **Yes** |
| 09 | Correct ticket count on success | DB: Ticket.countDocuments=6 | **Yes** |
| 10 | All tickets in order response | Response: tickets.length = quantity = 5 | No |

### Findings

**PASS (strong points):**
- Tests 04–09 all verify DB/Redis state — excellent rollback coverage
- Test 04 specifically validates that a successfully-reserved section gets rolled back when a later section fails
- Test 05 + 06 together form a complete "no orphaned state" check (DB tickets + Redis holds)
- Test 08 verifies BOTH sections' held_count unchanged on failure (not just the failed section)
- Test 07 verifies both sections' held_count on success — per-section granularity

**ISSUES:**

1. **CRITICAL — Missing: Concurrent/atomic availability test (Spec Test #07)**
   - Spec requires `test_atomic_07_availability_check_within_transaction` — concurrent orders racing for last seats, only one succeeds, no overselling
   - This is the core validation that the transaction/lock mechanism prevents TOCTOU races
   - No test simulates concurrent requests — a candidate could use the buggy sequential approach and still pass all tests

2. **HIGH — Missing: Order document not verified in DB on any path**
   - On success: no test queries `Order.findOne()` to verify the order document exists with correct `user_id`, `event_id`, `quantity`, `status`, `tickets` array
   - On failure: no test verifies that no Order document was created (rolled back along with tickets/sections)
   - A candidate could create the Order outside the transaction and it would persist on failure

3. **HIGH — Missing: Error message validation**
   - Tests 01, 02, and 04 only check status codes (404/400) but never verify error messages
   - Spec expects `"insufficient capacity"` in the error response for Test 04
   - Candidate can return generic errors for any reason

4. **MEDIUM — Missing: Ticket fields not verified on success**
   - No test checks individual ticket documents for: `status='held'`, correct `section_id` per ticket, `unit_price` matching section `base_price`, `service_fee`, `facility_fee`, `hold_expires_at` set
   - A candidate could create tickets with wrong status or wrong section assignments

5. **MEDIUM — Missing: Redis holds not verified on success**
   - Test 06 verifies Redis holds are absent on failure, but no test verifies Redis holds ARE present on success
   - Should check `redisClient.exists(`hold:${sectionId}:${ticketId}`)` for each created ticket

6. **MEDIUM — Hardcoded pricing/capacities**
   - VIP always `base_price: 200`, Orchestra always `base_price: 100`
   - Capacities always 50 VIP, 100 Orchestra
   - Failure scenario always `sold_count: 98` with `quantity: 5` (2 available < 5 requested)
   - Should use dynamic/random values with computed expectations

7. **LOW — Test 10: Response tickets not validated per-section**
   - Checks total tickets length but doesn't verify tickets belong to the correct sections
   - Spec test #10 says "correct sections" in the key assertion column

8. **LOW — Missing: 3+ section test for sequential rollback**
   - All tests use exactly 2 sections; a 3-section test (where section 3 fails) would better validate that sections 1 AND 2 are both rolled back, not just section 1

9. **LOW — Test 03: total_amount only checked as type `number`**
   - `expect(res.body.total_amount).to.be.a('number')` — doesn't verify the computed value
   - Should compute expected total based on section prices, quantities, and fee structure

### Summary

| Issue Type | Count | Details |
|-----------|-------|---------|
| Missing spec test case | 1 | Concurrent/atomic TOCTOU race test (spec test #07) |
| Missing DB verification | 2 | Order document (success + failure paths) |
| Missing Redis verification | 1 | Redis holds not verified on success path |
| Missing error messages | 1 | Tests 01, 02, 04 don't check error text |
| Missing field validation | 1 | Individual ticket fields not verified on success |
| Hardcoded values | 1 | All pricing/capacities static across tests |
| Insufficient response checks | 2 | Per-section ticket validation, total_amount value |
| Insufficient scope | 1 | Only 2-section tests, no 3+ section rollback |

**Verdict:** Excellent rollback verification in tests 04–09 — this is the strongest area and directly tests the bug's core issue (orphaned reservations). However, the missing concurrent/atomic test is critical since it's the only way to validate that the fix uses transactions rather than a simple sequential check-then-fix approach. No Order document DB verification is a significant gap. Needs the concurrency test, Order verification, and Redis success-path checks to be fully robust.

---

## Task 11 — Seat Availability Map for Event Section (Feature 1)

**Test file:** `test/task11/app.spec.js`
**Spec reference:** Feature 1 (Easy) — `EVENT_TICKETING_SPEC.md` lines 2148–2306
**Endpoint:** `GET /api/v1/events/:id/sections/:sectionId/seat-map` (public, no auth)

### What the spec requires

- Return 404 if section or event doesn't exist
- Compute `available = capacity - sold_count - held_count`
- Compute `sell_through_pct = (sold_count / capacity) * 100`
- Determine pricing tier from sell-through: standard (1.0x), high_demand (1.25x), very_high_demand (1.5x), peak (2.0x)
- Compute `current_price = base_price * multiplier`
- Compute fees: `service_fee = current_price * 0.12`, `facility_fee = current_price * 0.05`
- Return `status`: `'available'` or `'sold_out'`
- Response includes: event_id, event_title, section_id, section_name, capacity, sold, held, available, sell_through_pct, pricing{}, status

### Current test coverage (8 tests)

| # | Test | What it checks | Spec alignment |
|---|------|----------------|----------------|
| 01 | Section not found | 404 status | Spec test #01 |
| 02 | Event not found | 404 status | Spec test #02 |
| 03 | Correct available count | available=30, sold=60, held=10, capacity=100 | Spec test #03 |
| 04 | sold_out status | status='sold_out', available=0 | Spec test #04 |
| 05 | Pricing tier/multiplier | tier='very_high_demand', multiplier=1.5, current_price=150 | Spec test #05 |
| 06 | Fee calculation | service_fee=18, facility_fee=7.5 | Spec test #06 |
| 07 | sell_through_pct | sell_through_pct=50 | Spec test #07 |
| 08 | All required fields | All properties exist + status='available' | Spec test #08 |

### Findings

**PASS (strong points):**
- All 8 spec test cases are covered — complete 1:1 mapping
- Test 03 checks all four availability fields (available, sold, held, capacity)
- Test 04 correctly tests sold_out boundary condition
- Test 08 validates full response structure including nested pricing fields
- No authentication required — clean public endpoint testing

**ISSUES:**

1. **HIGH — Only 1 of 4 pricing tiers tested**
   - Test 05 only tests very_high_demand (80% sell-through → 1.5x)
   - Missing: standard (<50% → 1.0x), high_demand (50–74% → 1.25x), peak (≥90% → 2.0x)
   - Candidate can hardcode `multiplier: 1.5, tier: 'very_high_demand'` and pass all pricing tests
   - Should test at least 2–3 distinct tiers with dynamic values

2. **HIGH — All values hardcoded across all tests**
   - Test 03: capacity:100, sold:60, held:10 → expects available:30
   - Test 05/06: capacity:100, sold:80, base_price:100 → expects multiplier:1.5, current_price:150, service_fee:18, facility_fee:7.5
   - Test 07: capacity:500, sold:250 → expects sell_through_pct:50
   - All can be satisfied by hardcoded return values without any computation

3. **MEDIUM — sold_out only tested via sold_count, not held_count**
   - Test 04 uses `sold_count: 100, held_count: 0` for sold_out
   - Should also test `sold_count: 90, held_count: 10` → available=0 → sold_out
   - Validates that `held_count` is included in the availability calculation for status determination

4. **MEDIUM — Fee calculation only tested at one tier/price point**
   - Test 06 only tests fees at current_price=150 (1.5x tier)
   - Should test fees at a different price point to prevent hardcoded fee values
   - Could combine with a different tier test (e.g., standard tier with different base_price)

5. **LOW — event_id/section_id values never verified against actual IDs**
   - Test 08 checks `have.property('event_id')` but never verifies the value matches
   - Should check `res.body.event_id.toString() === event._id.toString()`

6. **LOW — base_price value never verified in pricing response**
   - `pricing.base_price` existence is checked in Test 08 but actual value is never asserted
   - Should verify it equals the section's configured base_price

### Summary

| Issue Type | Count | Details |
|-----------|-------|---------|
| Missing tier coverage | 1 | Only 1 of 4 pricing tiers tested (very_high_demand) |
| Hardcoded values | 1 | All test data and expectations are static |
| Missing edge case | 1 | sold_out via held_count not tested |
| Missing fee variation | 1 | Fees only tested at one price point |
| Missing value assertions | 2 | event_id/section_id values, base_price value |

**Note on DB validation:** This is a **read-only GET endpoint** — it does not create or modify any documents. DB validation (verifying persisted state after a write) does not apply here. The tests set up DB fixtures and verify the response correctly reflects that data. The anti-cheat concern for read-only endpoints is hardcoded response values rather than missing DB writes.

**Verdict:** Clean and well-structured for an Easy task — all 8 spec tests have 1:1 mapping with good response shape validation. The main weakness is that only 1 of 4 pricing tiers is tested, which means a candidate can hardcode the tier/multiplier. Adding 2–3 more tier tests with dynamic base_price values would make this significantly more robust. The hardcoded values issue is moderate since this is a read-only endpoint, but using varied data per test would still prevent stub cheating.

---

## Task 12 — Event Schedule with Date Filter and Venue Grouping (Feature 2)

**Test file:** `test/task12/app.spec.js`
**Spec reference:** Feature 2 (Easy) — `EVENT_TICKETING_SPEC.md` lines 2309–2497
**Endpoint:** `GET /api/v1/events/schedule?start_date=<ISO>&end_date=<ISO>` (public, no auth)

### What the spec requires

- Validation: missing dates → 400, invalid date format → 400, end_date ≤ start_date → 400
- Only return events with status `on_sale` or `sold_out` (exclude draft, cancelled, completed)
- Filter by date range: `start_date >= query.start_date AND start_date <= query.end_date`
- Sort events by `start_date` ascending
- Group events by venue (venue_id, venue_name, city)
- Per event: compute `price_range` (min/max base_price from sections), `total_available` (sum of capacity-sold-held across sections), `sections_count`
- Response: `period_start`, `period_end`, `venues[]`, `total_events`
- Each event: `event_id`, `title`, `category`, `start_date`, `end_date`, `status`, `sections_count`, `total_available`, `price_range{min, max}`

### Current test coverage (8 tests — spec has 7, +1 bonus)

| # | Test | What it checks | Spec alignment |
|---|------|----------------|----------------|
| 01 | Missing dates | 400 + error includes 'required' | Spec test #01 |
| 02 | Invalid date format | 400 + error includes 'invalid' | Spec test #02 |
| 03 | end_date before start_date | 400 + error includes 'after' | Spec test #03 |
| 04 | Group events by venue | venues.length=2, total_events=3, arenaOne.events.length=2 | Spec test #04 |
| 05 | Only events in date range | total_events=1, title verified | Spec test #05 |
| 06 | price_range from sections | min=50, max=200 (3 sections) | Spec test #06 |
| 07 | total_available across sections | total_available=210, sections_count=2 | Spec test #07 |
| 08 | Exclude draft events | total_events=1, only 'Active Event' | Bonus (not in spec) |

### Findings

**PASS (strong points):**
- All 3 validation tests check error message content (`'required'`, `'invalid'`, `'after'`) — better than status-only
- Test 04 properly validates venue grouping with 2 venues and per-venue event count
- Test 06 and 07 test section aggregation logic (price_range min/max + total_available sum)
- Test 08 is a bonus test beyond spec — validates draft event exclusion
- 8 tests for an Easy task is good coverage

**ISSUES:**

1. **MEDIUM — Missing: sold_out events should be included**
   - Spec queries `status: { $in: ['on_sale', 'sold_out'] }` — both statuses should appear in results
   - All test events use `status: 'on_sale'` — no test creates a `sold_out` event
   - Candidate could filter only `on_sale` and pass all tests

2. **MEDIUM — Missing: Event sort order not verified**
   - Spec solution sorts by `start_date: 1` (ascending)
   - Test 04 creates events at different dates within the same venue but doesn't verify chronological order
   - Should check that `arenaOne.events[0]` comes before `arenaOne.events[1]` by date

3. **MEDIUM — Missing: Top-level response fields not checked**
   - Spec response includes `period_start` and `period_end` as ISO strings
   - No test checks these fields exist or have correct values
   - A candidate could omit them entirely

4. **MEDIUM — Missing: Per-event field validation**
   - No test validates individual event fields: `event_id`, `category`, `start_date`, `end_date`, `status`
   - Test 05 only checks `title`; Test 07 checks `total_available` and `sections_count`
   - Should verify at least one event has the complete response structure

5. **LOW — Hardcoded values in Tests 06, 07**
   - Test 06: base_prices 50/100/200, expects min:50 max:200
   - Test 07: capacities/sold/held hardcoded, expects total_available:210
   - Could use dynamic values with computed expectations

6. **LOW — Missing: Empty date range result**
   - No test for a date range with zero matching events — should return `venues: [], total_events: 0`

7. **LOW — Missing: Cancelled event exclusion**
   - Test 08 covers draft exclusion but not cancelled event exclusion
   - Should verify cancelled events are also filtered out

8. **LOW — Test 04: Venue city not verified**
   - Spec's key test example checks `msgVenue.city` but the actual test doesn't verify city on venue groups

### Summary

| Issue Type | Count | Details |
|-----------|-------|---------|
| Missing status coverage | 1 | sold_out events not tested as included |
| Missing sort verification | 1 | Event chronological order not checked |
| Missing response fields | 2 | period_start/period_end, per-event fields |
| Hardcoded values | 1 | Section prices and availability static |
| Missing edge cases | 2 | Empty result, cancelled event exclusion |
| Missing value assertions | 1 | Venue city not verified |

**Note on DB validation:** This is a **read-only GET endpoint** — it does not create or modify any documents. DB validation (verifying persisted state after a write) does not apply here. The tests set up DB fixtures and verify the response correctly reflects that data. The anti-cheat concern for read-only endpoints is hardcoded response values rather than missing DB writes.

**Verdict:** Solid for an Easy task — good validation coverage with error message checks, and proper section aggregation tests. The main gap is that only `on_sale` events are created — never `sold_out` — so the dual-status inclusion can't be verified. Adding a sold_out event to Test 04 or 05, verifying sort order, and checking top-level response fields (period_start/period_end) would strengthen this significantly.

---

## Task 13 — Waitlist Management with Automatic Position Assignment (Feature 3)

**Test file:** `test/task13/app.spec.js`
**Spec reference:** Feature 3 (Medium) — `EVENT_TICKETING_SPEC.md` lines 2501–2693
**Endpoints:** `POST /api/v1/events/:id/waitlist` (join) + `GET /api/v1/events/:id/waitlist` (query position)
**Auth:** Yes (Bearer token)
**Write endpoint:** Yes — POST creates `WaitlistEntry` documents

### What the spec requires

- Validation: event not found → 404, event not sold_out → 400, duplicate entry → 409, not on waitlist (GET) → 404
- Atomic sequential position assignment via counter collection
- Return position, ahead count, status='waiting', joined_at
- GET: return position, ahead, total_waiting, status
- Notified users should NOT be counted in ahead count
- Auth required (401 without token)
- Response fields: waitlist_id, event_id, position, ahead, status, joined_at

### Current test coverage (10 tests)

| # | Test | What it checks | DB verified? | Spec alignment |
|---|------|----------------|--------------|----------------|
| 01 | Event not found | 404 status | No | Spec #01 |
| 02 | Event not sold out | 400 + error includes 'sold-out' | No | Spec #02 |
| 03 | Duplicate entry | 409 + error includes 'already' | No | Spec #03 |
| 04 | First user gets position 1 | Response: position=1, ahead=0 | No | Spec #04 |
| 05 | Sequential positions (3 users) | Response: positions 1, 2, 3 | No | Spec #05 |
| 06 | Correct ahead count | Response: position=3, ahead=2 | No | Spec #06 |
| 07 | total_waiting on GET | Response: total_waiting=3, ahead=1, position=2 | No | Spec #07 |
| 08 | Notified users not in ahead | DB update + GET: ahead=1 (was 2) | **Partial** (writes to DB, reads via API) | Spec #08 |
| 09 | 401 without auth | 401 status | No | Spec #09 |
| 10 | 404 GET when not on waitlist | 404 + error includes 'not on waitlist' | No | Bonus (replaces spec #10) |

### Findings

**PASS (strong points):**
- 9 of 10 spec tests covered + 1 bonus validation test (GET when not on waitlist)
- Tests 02, 03, 10 all check error message content — not just status codes
- Test 05 validates sequential position assignment across 3 users
- Test 07 validates the GET endpoint with total_waiting, ahead, and position
- Test 08 is well-designed — modifies a WaitlistEntry status to 'notified' then verifies ahead recalculation
- beforeEach resets `waitlist_counters` collection — prevents position leakage between tests

**ISSUES:**

1. **HIGH — Missing: DB verification for WaitlistEntry creation**
   - This is a **write endpoint** — POST creates WaitlistEntry documents in MongoDB
   - No test queries `WaitlistEntry.findOne()` after POST to verify the document was actually persisted
   - Should verify: `event_id`, `user_id`, `position`, `status: 'waiting'` are stored correctly
   - A candidate could return correct JSON response without actually creating the document

2. **HIGH — Missing: POST response structure validation (Spec Test #10)**
   - Spec requires checking POST response has: `waitlist_id`, `event_id`, `position`, `ahead`, `status`, `joined_at`
   - No test validates the complete response structure for the POST endpoint
   - Tests only check `position` and `ahead` — missing `waitlist_id`, `event_id`, `status`, `joined_at`

3. **MEDIUM — Test 05: ahead count not verified per user**
   - Spec test #05's key example checks both `position` AND `ahead` for each user: ahead=0, ahead=1, ahead=2
   - Current Test 05 only checks positions (1, 2, 3) but NOT ahead counts per user
   - Test 06 separately checks ahead=2 for user3, but ahead for users 1 and 2 is only checked in Test 04

4. **MEDIUM — Missing: GET response structure validation**
   - Test 07 checks `total_waiting`, `ahead`, `position` but doesn't check for `waitlist_id`, `event_id`, `status`, `joined_at`
   - GET response structure should be fully validated in at least one test

5. **MEDIUM — Test 03: First join success not verified**
   - Test joins once then joins again for 409, but doesn't verify the first join returned status 201
   - Should check `res1.status === 201` before asserting the duplicate response

6. **LOW — Spec says 5 users for total_waiting but test uses 3**
   - Spec test #07 describes "5 users waiting, query → total_waiting == 5"
   - Actual test uses 3 users — functionally equivalent but less robust against edge cases

7. **LOW — event_id not verified in any response**
   - No test checks that `res.body.event_id` matches the actual event's ID

### Summary

| Issue Type | Count | Details |
|-----------|-------|---------|
| Missing DB verification | 1 | WaitlistEntry not checked in DB after POST |
| Missing response structure | 2 | POST and GET response fields incomplete |
| Missing ahead per user | 1 | Test 05 only checks positions, not ahead counts |
| Missing success assertion | 1 | Test 03 first join not verified as 201 |
| Missing value assertions | 1 | event_id never verified in responses |

**Verdict:** Good logical coverage — sequential positions, ahead counts, notified-user exclusion, and both endpoints tested. The main gap is that no test verifies `WaitlistEntry` documents in the DB after creation (critical for a write endpoint). Response structure validation is also missing — only position/ahead are checked, never the full field set. Adding DB verification for at least one POST test and a response structure check would close the key gaps.

---

## Task 14 — Ticket Transfer Between Users with Validation Chain (Feature 4)

**Test file:** `test/task14/app.spec.js`
**Spec reference:** Feature 4 (Medium) — `EVENT_TICKETING_SPEC.md` lines 2697–2871
**Endpoint:** `POST /api/v1/tickets/:id/transfer` (with `{ to_email }`)
**Auth:** Yes (Bearer token)
**Write endpoint:** Yes — modifies original Ticket, creates new Ticket for recipient

### What the spec requires

- 6 validation rules: missing to_email (400), ticket not found/not owned (404), not confirmed (400), event passed (400), recipient not found (404), self-transfer (400)
- On success: set original ticket `status='transferred'`, set `transferred_at`
- Create new ticket for recipient: same `order_id`, `event_id`, `section_id`, `original_user_id`, pricing; but `user_id=recipient`, `status='confirmed'`
- Response: `transfer_id`, `original_ticket_id`, `new_ticket_id`, `from_user`, `to_user`, `to_email`, `event_title`, `section_name`, `transferred_at`

### Current test coverage (10 tests)

| # | Test | What it checks | DB verified? | Spec alignment |
|---|------|----------------|--------------|----------------|
| 01 | Missing to_email | 400 + error includes 'to_email' | No | Spec #01 |
| 02 | Ticket not found | 404 status | No | Spec #02 |
| 03 | Not ticket owner | 404 status | No | Spec #03 |
| 04 | Ticket not confirmed (held) | 400 + error includes 'confirmed' | No | Spec #04 |
| 05 | Event already started | 400 + error includes 'started' | No | Spec #05 |
| 06 | Recipient not found | 404 + error includes 'recipient' | No | Spec #06 |
| 07 | Self-transfer | 400 + error includes 'yourself' | No | Spec #07 |
| 08 | Original ticket invalidated | DB: status='transferred', transferred_at set | **Yes** | Spec #08 |
| 09 | New ticket for recipient | DB: user_id, status, event_id, section_id | **Yes** | Spec #09 |
| 10 | Pricing preserved | DB: original_user_id, unit_price, service_fee, facility_fee | **Yes** | Spec #10 |

### Findings

**PASS (strong points):**
- All 10 spec tests covered — perfect 1:1 mapping
- All 7 validation tests (01–07) check error message content, not just status codes — excellent
- Tests 08–10 all verify DB state directly — strongest area
- Test 08: verifies original ticket `status='transferred'` AND `transferred_at` is not null
- Test 09: verifies new ticket has correct `user_id`, `status`, `event_id`, `section_id` in DB
- Test 10: verifies `original_user_id` preserved (audit trail) + all 3 pricing fields preserved
- Test 05: properly creates a past event with `start_date` in the past — correct time-based validation setup
- This is one of the strongest test files across all tasks

**ISSUES:**

1. **MEDIUM — Hardcoded pricing values**
   - `createConfirmedTicket` helper always uses `unit_price: 100`, `service_fee: 12`, `facility_fee: 5`
   - Test 10 expects these exact values — candidate can hardcode pricing on the new ticket
   - Should use dynamic/random pricing with computed expectations

2. **MEDIUM — Missing: Response structure validation**
   - No test validates the full transfer response fields: `transfer_id`, `original_ticket_id`, `new_ticket_id`, `from_user`, `to_user`, `to_email`, `event_title`, `section_name`, `transferred_at`
   - Test 09 checks `res.body.new_ticket_id` exists but no test validates the complete response shape

3. **MEDIUM — Rejection tests don't verify DB unchanged**
   - Tests 01–07 check error status/messages but don't query DB to verify the original ticket `status` remains `'confirmed'`
   - A candidate could partially process the transfer (modify status) before hitting the validation error

4. **LOW — Missing: Total ticket count verification after transfer**
   - After transfer, should verify `Ticket.countDocuments()` increased by 1 (original + new)
   - Ensures the implementation creates a NEW ticket rather than modifying the existing one in-place

5. **LOW — Missing: Email case sensitivity test**
   - Spec solution uses `to_email.toLowerCase()` for recipient lookup
   - No test verifies that `RECIPIENT@TEST.COM` resolves to the same user as `recipient@test.com`

6. **LOW — Missing: order_id preservation not verified**
   - Spec solution copies `order_id` from original ticket to new ticket
   - No test checks `newTicket.order_id` matches the original ticket's `order_id`

### Summary

| Issue Type | Count | Details |
|-----------|-------|---------|
| Hardcoded values | 1 | All pricing static (unit_price:100, service_fee:12, facility_fee:5) |
| Missing response structure | 1 | Full transfer response fields never validated |
| Missing DB-unchanged check | 1 | Rejection paths don't verify ticket state unchanged |
| Missing count verification | 1 | Total ticket count after transfer not checked |
| Missing edge case | 1 | Email case insensitivity not tested |
| Missing field check | 1 | order_id preservation not verified |

**Verdict:** One of the strongest test files — all 10 spec tests covered with error message validation on all rejection paths and DB verification on all success paths. The validation chain (7 distinct checks) is comprehensive and well-ordered. Main improvements needed: randomize pricing to prevent hardcoding, add response structure validation, and verify DB-unchanged on rejection paths. These are moderate enhancements rather than critical gaps.

---

## Task 15 — Dynamic Pricing Engine with Urgency and Quantity Factors (Feature 5)

**Test file:** `test/task15/app.spec.js`
**Spec reference:** Feature 5 (Hard) — `EVENT_TICKETING_SPEC.md` lines 2875–3119
**Endpoint:** `GET /api/v1/events/:eventId/sections/:sectionId/price-quote?quantity=N`

### What the spec requires

- **Three independent pricing factors** multiplied together:
  1. **Demand multiplier** (from sell-through %): 1.0x / 1.25x / 1.5x / 2.0x
  2. **Urgency multiplier** (from days until event): >30d=1.0x, 15–30d=1.1x, 7–14d=1.2x, 3–6d=1.3x, 1–2d=1.4x, <24h=1.5x
  3. **Quantity discount** (from ticket count): 1–3=0%, 4–7=5%, 8+=10%
- `final_price = base_price × demand_multiplier × urgency_multiplier`
- `discount_amount = final_price × quantity × quantity_discount_pct`
- Response must include: `base_price`, `demand_multiplier`, `urgency_multiplier`, `quantity_discount_pct`, `final_unit_price`, `quantity`, `line_total`, `discount_amount`, `subtotal`, pricing `tier`, `urgency_tier`, `breakdown` object
- Fees calculated on final_unit_price: service_fee (12%), facility_fee (5%)
- Validation: quantity required (>0 integer), section/event must exist

### Current test coverage (11 tests)

| # | Test | What it checks |
|---|------|----------------|
| 01 | Missing quantity | 400 status |
| 02 | Non-positive quantity (0) | 400 status |
| 03 | Non-integer quantity (2.5) | 400 status |
| 04 | Non-existent section | 404 status |
| 05 | Non-existent event | 404 status |
| 06 | Standard demand (10% sell-through) | demand_multiplier=1.0, tier='standard' |
| 07 | High demand (60% sell-through) | demand_multiplier=1.25, tier='high_demand' |
| 08 | Very high demand (80% sell-through) | demand_multiplier=1.5, tier='very_high_demand' |
| 09 | Peak demand (95% sell-through) | demand_multiplier=2.0, tier='peak' |
| 10 | Fee calculation | service_fee=12% and facility_fee=5% of final_unit_price |
| 11 | Response shape | All required fields present |

### Findings

#### PASS — Things done well
- All 4 demand tiers tested with correct sell-through thresholds and expected multipliers
- Good input validation coverage (missing, zero, non-integer quantity)
- 404 tests for both non-existent section and event
- Fee calculation test verifies both service_fee and facility_fee
- Response shape test checks all required fields

#### ISSUES FOUND

##### 1. CRITICAL: Urgency multiplier completely untested
**Severity:** Critical
- The spec defines 6 urgency tiers based on days until event (>30d=1.0x through <24h=1.5x)
- **Every test creates events 45 days in the future** (`Date.now() + 45 * 24 * 60 * 60 * 1000`), so urgency_multiplier is always 1.0x
- A candidate could hardcode `urgency_multiplier: 1.0` and pass all tests
- Need at minimum tests for: 15–30d (1.1x), 7–14d (1.2x), 1–2d (1.4x), <24h (1.5x)
- This is one of the three core pricing factors and represents ~33% of the feature logic

##### 2. CRITICAL: Quantity discount completely untested
**Severity:** Critical
- The spec defines 3 quantity tiers: 1–3=0%, 4–7=5%, 8+=10%
- Test 10 uses `quantity=4` but **expects NO discount** (`discount_amount: 0`), contradicting the spec which says 4–7 tickets should get 5% off
- No test uses quantity=8+ to test the 10% tier
- A candidate could hardcode `quantity_discount_pct: 0` and pass all tests
- This represents another ~33% of the feature logic

##### 3. CRITICAL: Combined-factors test missing
**Severity:** Critical
- The spec's core formula is `final_price = base_price × demand_multiplier × urgency_multiplier` with quantity discount applied on top
- No test verifies all three factors working together (e.g., high demand + near-event urgency + bulk quantity)
- A candidate could implement each factor in isolation but fail to multiply them correctly

##### 4. All pricing values are hardcoded
**Severity:** Medium
- Every section uses `base_price: 100` — candidates can hardcode expected values
- Sell-through percentages use clean numbers (10%, 60%, 80%, 95%) — easily recognizable
- Should use randomized base prices and computed expectations per anti-cheat rules (Section 9.6)

##### 5. Subtotal and line_total calculations not verified
**Severity:** Medium
- No test checks `line_total = final_unit_price × quantity` arithmetic
- No test checks `subtotal = line_total - discount_amount`
- These are simple but essential calculations that could silently be wrong

##### 6. The breakdown object is not validated
**Severity:** Low
- Test 11 checks the `breakdown` key exists but never validates its internal structure or values
- Spec requires breakdown to show per-ticket cost decomposition

**Verdict:** This is the **weakest test file relative to task complexity**. For a Hard-level task with three independent pricing factors, two of the three factors (urgency and quantity discount) are completely untested. A candidate could pass all 11 tests by implementing only the demand multiplier from Feature 1 (Task 11) and hardcoding the other two factors. The urgency and quantity discount tests are essential additions before this task is usable.

---

## Task 16 — Refund Processing with Tiered Penalties and Bulk Operations (Feature 6)

**Test file:** `test/task16/app.spec.js`
**Spec reference:** Feature 6 (Hard) — `EVENT_TICKETING_SPEC.md` lines 3123–3389
**Endpoint:** `POST /api/v1/orders/:orderId/refund`

### What the spec requires

- **Tiered refund penalties** based on time until event:
  - >7 days before: 100% refund (no penalty)
  - 3–7 days: 75% refund (25% penalty)
  - 1–3 days: 50% refund (50% penalty)
  - <24 hours: Refund rejected (400 error)
- **Full refund**: All tickets in order refunded, order status → `refunded`
- **Partial refund** (optional `ticket_ids` array): Only specified tickets refunded, order status → `partially_refunded`
- **Organizer cancellation**: If event is `cancelled`, 100% refund regardless of timing
- Ticket status → `refunded`, section `sold_count` decremented
- Response must include: `refund_amount`, `penalty_pct`, `refund_pct`, `tickets_refunded`, per-ticket breakdown
- Promo codes: if order used promo, refund is on discounted amount
- Validation: order must exist, must be confirmed, must belong to authenticated user

### Current test coverage (12 tests)

| # | Test | What it checks |
|---|------|----------------|
| 01 | Non-existent order | 404 status |
| 02 | Unconfirmed order (pending) | 400 status + 'confirmed' in error |
| 03 | Other user's order | 404 status |
| 04 | <24h before event | 400 status + 'too close' in error |
| 05 | >7 days — full refund (100%) | refund_pct=100, penalty_pct=0, correct refund_amount |
| 06 | 3–7 days — 75% refund | refund_pct=75, penalty_pct=25 |
| 07 | 1–3 days — 50% refund | refund_pct=50, penalty_pct=50 |
| 08 | Organizer cancellation — full refund | 100% refund when event status=cancelled |
| 09 | DB: ticket status → refunded | Ticket.findById confirms status='refunded' |
| 10 | DB: order status → refunded | Order.findById confirms status='refunded' |
| 11 | DB: section sold_count decremented | Section.findById confirms sold_count decreased |
| 12 | tickets_refunded count in response | res.body.tickets_refunded equals ticket count |

### Findings

#### PASS — Things done well
- All 4 refund tiers tested (>7d, 3–7d, 1–3d, <24h rejection)
- Strong DB verification: tests 09–11 check ticket status, order status, and section counter
- Organizer cancellation override tested (event status=cancelled bypasses time check)
- Ownership validation tested (other user's order returns 404)
- Good error message matching ('confirmed', 'too close')

#### ISSUES FOUND

##### 1. CRITICAL: Partial refund (ticket_ids) completely untested
**Severity:** Critical
- The spec defines partial refund: sending `ticket_ids` array to refund specific tickets from a multi-ticket order
- Order should transition to `partially_refunded` when only some tickets are refunded
- No test sends `ticket_ids` in the request body
- No test verifies the `partially_refunded` status
- This is a significant feature for a Hard-level task

##### 2. Response breakdown structure not validated
**Severity:** Medium
- The spec requires per-ticket breakdown in the response showing each ticket's refund details
- Tests check `refund_amount`, `refund_pct`, `penalty_pct`, and `tickets_refunded` but don't validate the breakdown array structure
- A candidate could return correct totals but wrong per-ticket details

##### 3. Refund amount calculation not verified against computed values
**Severity:** Medium
- Tests 05–07 check `refund_pct` and `penalty_pct` but the `refund_amount` is only verified in test 05 (100% tier)
- Tests 06 and 07 don't verify the actual `refund_amount` value — only the percentages
- A candidate could return correct percentages but wrong dollar amounts

##### 4. Promo code discount not tested in refund context
**Severity:** Medium
- The spec states refunds on promo-discounted orders should refund the discounted amount, not original
- No test creates an order with a promo code and then refunds it
- A candidate could refund the full pre-discount amount

##### 5. Multi-ticket order refund amount not tested
**Severity:** Medium
- All refund tests use single-ticket orders (quantity=1)
- The arithmetic for multi-ticket refunds (`quantity × unit_price × refund_pct`) is never exercised
- Should test with quantity > 1 to ensure correct aggregation

##### 6. Hardcoded pricing values
**Severity:** Low
- All orders use `base_price: 100`, `total_amount: 120` — candidates can hardcode refund amounts
- Should randomize prices and compute expected refund amounts dynamically

##### 7. Double-refund prevention not tested
**Severity:** Low
- No test attempts to refund the same order twice
- A candidate could allow duplicate refunds, draining money

**Verdict:** Strong test file for basic refund flow — all 4 tiers tested with DB verification on success paths. The main critical gap is the complete absence of partial refund testing (`ticket_ids` + `partially_refunded` status), which is a key differentiator for a Hard-level task. Secondary improvements needed: verify refund_amount arithmetic at non-100% tiers, test promo-discounted refunds, and test multi-ticket orders.

---

## Review Complete

All 16 tasks have been reviewed. Summary of critical findings across all tasks:

### Most Critical Gaps (would allow candidates to pass without proper implementation)
1. **Task 15**: Urgency multiplier and quantity discount completely untested — 2 of 3 core pricing factors
2. **Task 16**: Partial refund (`ticket_ids`) completely untested
3. **Task 9**: Partial failure / partial cascade handling untested
4. **Task 13**: No DB verification for WaitlistEntry creation on POST
5. **Tasks 1–10**: Pervasive hardcoded values enabling pattern-matching cheats

### Recurring Patterns Across All Tasks
- **Hardcoded pricing**: Nearly every task uses `base_price: 100` — should randomize
- **Missing DB verification on rejection paths**: Tests check HTTP 400/404 but rarely verify DB was unchanged
- **Response structure validation**: Often superficial (checks a few fields, not the full shape)
- **Anti-cheat weakness**: Clean round numbers, predictable patterns, static test data
