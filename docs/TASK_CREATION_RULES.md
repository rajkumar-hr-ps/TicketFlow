# Task Creation Rules & Guidelines

**Version:** 3.0.0
**Date:** 2026-02-17
**Purpose:** Reusable rules for designing backend application challenges and their tasks (bugs + features) for HackerRank-style coding assessments.

---

## Table of Contents

1. [Objective](#1-objective)
2. [Tech Stack](#2-tech-stack)
3. [Application Design Rules](#3-application-design-rules)
4. [Question Structure](#4-question-structure)
5. [Task Types](#5-task-types)
6. [Bug Design Rules](#6-bug-design-rules)
7. [Feature Design Rules](#7-feature-design-rules)
8. [Difficulty Matrix](#8-difficulty-matrix)
9. [Testing Rules](#9-testing-rules)
10. [Independence & Scoring](#10-independence--scoring)
11. [Anti-Patterns](#11-anti-patterns)
12. [Research Process](#12-research-process)
13. [Documentation Template](#13-documentation-template)
14. [Real-World Bug Examples](#14-real-world-bug-examples-research-backed)

---

## 1. Objective

Design "Work Sample Simulations" — realistic backend application challenges that evaluate a candidate's ability to:

- **Debug** logical, architectural, and security-related errors in unfamiliar codebases
- **Navigate** multi-file project structures (routes → controllers → services → models → utils)
- **Implement** missing features by understanding existing patterns and conventions
- **Reason critically** about data flow, state management, and edge cases
- **Manage time** effectively under constraints

These are NOT algorithmic puzzles. They simulate real day-to-day backend engineering work.

---

## 2. Tech Stack

### 2.1 Core Stack (MERN Backend)

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js | 22.x+ |
| **Framework** | Express.js | 5.x |
| **Database** | MongoDB | 8.x+ |
| **ODM** | Mongoose | 9.x+ |
| **Testing** | Mocha + Chai | Mocha 11.x, Chai 5.x |
| **Auth** | JWT (jsonwebtoken) | — |

### 2.1.1 Optional Extended Stack

Use when the application domain requires caching, async processing, or job queues:

| Layer | Technology | Version | Use Case |
|-------|-----------|---------|----------|
| **Cache** | Redis | 8.x+ | Equipment listing cache, session store, rate limiting |
| **Job Queue** | BullMQ | 5.x+ | Async payment processing, email notifications, scheduled tasks |

When Redis/Bull are included:
- Redis is a **required runtime dependency** — the app must connect on startup
- BullMQ queues are backed by Redis — same connection or separate
- Test setup must handle Redis connection + flush between tests
- Cache-related bugs become available as task candidates (cache invalidation, key design, TTL issues)

### 2.2 Stack Constraints

- **Backend only** — no frontend/React code
- **External APIs / third-party packages are optional** — the application can integrate external services or npm packages where it adds realism, but these are not required and the core application must function independently
- **MongoDB as primary data store** — all business data in MongoDB collections
- **Mongoose for data modeling** — schemas, validation, middleware, indexes
- **Express middleware pattern** — routes → middleware → controllers → services → models
- **Redis for caching** (when extended stack is used) — cache service with get/set/invalidate pattern, TTL-based expiry
- **Bull for async jobs** (when extended stack is used) — job processors with retry logic, idempotency, failure handling

### 2.3 Project Structure Convention

```
src/
  app.js              # Express app setup, middleware registration
  server.js           # Server entry point
  config/
    db.js             # MongoDB connection
    redis.js          # Redis client (if extended stack)
    env.js            # Environment config
  middleware/
    auth.js           # JWT authentication
    validation.js     # Request validation
    errorHandler.js   # Centralized error handling
    rateLimiter.js    # Rate limiting (if applicable)
  models/
    User.js           # Mongoose schemas
    Equipment.js
    Rental.js
  routes/
    auth.routes.js    # Route definitions
    equipment.routes.js
    rental.routes.js
  controllers/
    auth.controller.js
    equipment.controller.js
    rental.controller.js
  services/
    auth.service.js   # Business logic
    equipment.service.js
    rental.service.js
    cache.service.js          # Redis cache helper (if extended stack)
    availability.service.js   # Shared availability calculations
  jobs/                       # Async job processors (if extended stack)
    payment.processor.js
    queue.js
  utils/
    helpers.js        # Shared utilities
    validators.js     # Input validation helpers
    softDelete.plugin.js      # Mongoose soft-delete plugin
  features/                   # Feature stubs (one directory per feature task)
    equipment_search/
      routes.js
      controller.js           # FEATURE stub
    rental_cost_estimator/
      routes.js
      controller.js           # FEATURE stub
tests/
  bug_*.test.js       # One test file per bug task
  feat_*.test.js      # One test file per feature task
  helpers/
    setup.js          # DB + Redis setup/teardown
    factory.js        # Test data factories
config.json           # Test reporter config
package.json          # Dependencies and scripts
```

---

## 3. Application Design Rules

### 3.1 Domain Selection

Choose domains that are:
- **Universally understood** — candidates shouldn't need domain expertise
- **Rich in business logic** — supports interesting calculations, state machines, validations
- **Multi-entity** — around 6-8 full-size data models with clear relationships
- **Scalable for tasks** — can accommodate 6-10+ independent tasks across the codebase

Good domains: equipment rental, inventory management, appointment scheduling, order management, project tracking, fleet management.

### 3.2 Application Requirements

- **Must start successfully** with all bugs present (no crash on startup)
- **Must have realistic data flow** across multiple layers (route → controller → service → model)
- **Must use standard patterns** — middleware, error handling, async/await, Mongoose hooks
- **Must seed initial data** for development and testing (via scripts or fixtures)
- **Dependency installation** automated via `npm install` (pretest/prestart hooks)

### 3.3 API Authentication Design

Endpoints should follow a clear public vs protected pattern:

| Type | Auth Required | Examples |
|------|--------------|---------|
| **Public (browse)** | No | List categories, list equipment, search equipment, get equipment details, category summaries |
| **Protected (mutations)** | Yes (JWT) | Create/update resources, create bookings, process returns, cancel rentals |
| **Protected (user-specific)** | Yes (JWT) | User profile, user's rentals, cost estimates, analytics reports |

**Rules:**
- Browse/read endpoints for public-facing data should NOT require authentication — this enables candidates to explore the API without needing to set up auth first
- Any endpoint that creates, modifies, or deletes data MUST require authentication
- Any endpoint returning user-specific data MUST require authentication
- Feature stubs should clearly document whether auth is required (`Auth: Yes` or `Auth: No`)

### 3.4 Code Quality in Solution Branch

The solution (working) code must:
- Follow Express.js/Node.js conventions
- Use async/await consistently (no callback hell)
- Have proper error handling at each layer
- Use Mongoose schema validation, middleware, and indexes appropriately
- Be clean and professional — no dead code, no excessive comments

---

## 4. Question Structure

### 4.1 Codebase-Style Questions

Each application challenge produces **codebase-style questions** on HackerRank — meaning:

- **Each task (bug or feature) is a SEPARATE HackerRank question**
- All questions share the **same base application** (same domain, same models, same API)
- Each question's codebase has **only ONE defect** (bug) or **one stub** (feature)
- The candidate sees one task per question, NOT all tasks bundled together
- Each question has its own test file that validates only that specific task

### 4.2 Codebase Branching per Question

For an application with N tasks, you produce:
- **1 solution branch** — fully working code, all endpoints functional
- **N question branches** — one per task, each branching from solution with only that task's defect injected

```
solution (everything works)
  ├── question/bug-1    (only Bug 1 injected, everything else works)
  ├── question/bug-2    (only Bug 2 injected, everything else works)
  ├── question/feat-1   (only Feature 1 stubbed, everything else works)
  └── ...
```

### 4.3 Implications

| Aspect | Project-Style | Codebase-Style (This) |
|--------|--------------|----------------------|
| **Questions** | 1 question, N tasks | N questions, 1 task each |
| **Codebase** | 1 codebase with ALL bugs/stubs | N codebases, each with 1 defect |
| **Scoring** | Total = passing tests / total tests | Each question scored independently (pass/fail) |
| **Independence** | Tasks share a codebase — must not cascade | Tasks in separate codebases — naturally isolated |
| **Candidate experience** | Fix/build as many as possible in time | Each question is standalone, assessed on its own |
| **Difficulty spread** | Mix in one sitting | Can assign different questions to different roles/levels |

### 4.4 What This Means for Task Design

- Each task must be **fully self-contained** — the candidate gets a working app with exactly one thing wrong/missing
- The rest of the application works correctly — candidate can run it, test other endpoints, understand the codebase
- The test file for each question tests ONLY that task's behavior
- The fix/implementation should require **substantial code** — since it's the ONLY task, it must justify a full question

---

## 5. Task Types

### 5.1 Bug Tasks

A **bug** is a flaw in existing, syntactically valid code that causes incorrect behavior. The code runs without crashing but produces wrong results, allows unauthorized access, or mishandles data.

**Bugs must resemble real-world issues** — the kind of bugs developers actually encounter and debug in production systems. They should NOT be textbook examples or simple pattern fixes.

### 5.2 Feature Tasks

A **feature** is missing functionality where the code structure exists (function signatures, route registration) but the implementation is absent or returns a placeholder.

- Function stubs may use `/* YOUR CODE HERE */` markers
- Feature stubs must NOT crash the application
- The route is registered and responds (e.g., returns 501 or empty response)

---

## 6. Bug Design Rules

### 6.1 Bug Categories (Real-World)

Bugs MUST fall into one of these categories, inspired by real issues found on StackOverflow, GitHub, and Reddit:

#### Category A: Race Conditions & Concurrency
- **Examples:** Double-booking, inventory overselling, duplicate payment processing, TOCTOU (Time-of-check-to-time-of-use) vulnerabilities
- **Pattern:** Two concurrent requests read stale data and both write, causing inconsistent state
- **Real-world source:** Common in e-commerce, booking systems, financial APIs
- **Testing approach:** Send concurrent requests and verify data integrity (use Promise.all with multiple API calls)

#### Category B: NoSQL Injection & Query Manipulation
- **Examples:** MongoDB operator injection ($gt, $ne, $regex), authentication bypass via query manipulation, data exfiltration via crafted queries
- **Pattern:** User input passed directly to MongoDB query without sanitization
- **Real-world source:** OWASP Top 10, numerous CVEs in Node.js/MongoDB apps
- **Testing approach:** Send malicious payloads in request body/params and verify they're rejected or sanitized

#### Category C: Validation & Sanitization Errors
- **Examples:** Missing input validation on nested objects, type coercion bugs, prototype pollution, accepting negative values where only positive are valid, missing boundary checks on date ranges
- **Pattern:** Input reaches business logic without proper validation, causing incorrect calculations or data corruption
- **Real-world source:** Every production API — validation bugs are the most common class
- **Testing approach:** Send edge-case inputs (negative numbers, empty strings, oversized payloads, wrong types) and verify proper rejection or handling

#### Category D: Authentication & Authorization Flaws
- **Examples:** Broken access control (IDOR — accessing other users' data), JWT validation gaps (missing expiry check, algorithm confusion), missing auth middleware on protected routes, privilege escalation
- **Pattern:** Authorization checks are incomplete, allowing unauthorized access to resources
- **Real-world source:** OWASP Top 10 #1 — Broken Access Control
- **Testing approach:** Make requests as User A to access User B's data, send expired/malformed tokens, access endpoints without proper role

#### Category E: Data Integrity & State Management
- **Examples:** Lost updates (concurrent writes overwriting each other), stale cache reads, incorrect aggregation logic, off-by-one in pagination, missing transaction rollbacks, inconsistent state after partial failures
- **Pattern:** Data becomes inconsistent due to incorrect update logic, missing atomicity, or wrong query conditions
- **Real-world source:** Common in any system with complex state transitions
- **Testing approach:** Create specific data states, perform operations, verify all related data is consistent

#### Category F: Error Handling & Recovery
- **Examples:** Swallowed errors hiding failures, async errors not propagated correctly, partial operations left in broken state, error messages leaking sensitive information, missing retry logic on transient failures
- **Pattern:** Error handling code exists but has logical flaws that cause silent failures or data corruption
- **Real-world source:** Production incident post-mortems on GitHub/blogs
- **Testing approach:** Trigger error conditions and verify the system handles them correctly (proper status codes, rollback of partial operations, no data leaks)

#### Category G: Security Vulnerabilities
- **Examples:** Missing rate limiting on sensitive endpoints, improper password comparison (timing attack), sensitive data in logs/responses, missing CORS restrictions, insecure direct object references
- **Pattern:** Security best practices not implemented or implemented incorrectly
- **Real-world source:** Security audit findings, HackerOne reports
- **Testing approach:** Exploit the vulnerability in tests (brute-force login, access others' data, check response headers)

### 6.2 Bug Quality Requirements

Every bug MUST satisfy ALL of these:

| Requirement | Description |
|-------------|-------------|
| **Realistic** | Based on real-world issues developers actually encounter. Research StackOverflow, GitHub issues, Reddit for evidence. |
| **Non-trivial** | Requires understanding the system, not just pattern matching. Cannot be a one-character fix or simple operator swap. |
| **Logical** | The code is syntactically valid and runs without errors. The bug is in the LOGIC, not the syntax. |
| **Non-crashing** | Application starts and runs normally. Bug only manifests during specific operations. |
| **Testable** | Can be detected by automated test cases. The test must have a clear pass/fail assertion. |
| **Subtle** | The buggy code looks plausible and professional. It's not obviously wrong at a glance. |
| **Validates knowledge** | Fixing it validates the candidate's knowledge and competency on that particular area of backend development. |

### 6.3 Bug Fix Size Requirements

> **Critical:** Every bug fix must require the candidate to **write a substantial chunk of code**. One-line fixes, simple operator changes, or variable renames are NOT valid bugs for codebase-style questions.

| Level | Minimum Fix Size | What "Fixing" Looks Like |
|-------|-----------------|-------------------------|
| **Easy** | 15-25 lines | Rewrite a function body with new algorithm/logic. Candidate must understand the business rules and implement them from scratch. |
| **Medium** | 25-40 lines | Write new middleware + update multiple call sites, OR restructure a service function with proper validation chain + atomic operations. |
| **Hard** | 35-50+ lines | Architectural changes: wrap flow in transactions, implement idempotency pattern, write multi-model rollback logic, or redesign async processing pipeline. |

**Anti-pattern examples (what NOT to do):**
- ❌ Change `objects` to `objects_active()` (one-line queryset swap)
- ❌ Change `start_date` to `delivery_date` (variable rename)
- ❌ Change `$gte` to `$lt` (operator swap)
- ❌ Add `await cacheService.invalidate()` (single missing call)
- ❌ Change `findById(id)` to `findOne({ _id: id, user_id })` (adding one filter)

**Good examples (what TO do):**
- ✅ Rewrite `calculateBaseCost()` — wrong algorithm entirely (flat rate vs tiered pricing)
- ✅ Write complete coupon validation — function exists but checks nothing (expiry, limits, atomicity)
- ✅ Write ownership middleware + integrate across routes + update controllers
- ✅ Wrap booking flow in MongoDB transaction with proper error handling
- ✅ Implement idempotent payment processor with upsert + status reconciliation
- ✅ Replace naive `total = base_price * quantity` with full fee pipeline (dynamic pricing + service/facility fees + promo discounts)
- ✅ Replace direct `status = newValue` with complete state machine (transition map + prerequisite checks)
- ✅ Replace `base64(ticketId)` barcode with HMAC-signed tokens + ownership binding + scan tracking
- ✅ Replace naive webhook handler (no verification) with signature check + amount matching + idempotency

### 6.3.1 The "Naive Stub" Pattern for Buggy Code

> **Critical Pattern:** Buggy code should be a **plausible but incomplete implementation** — a naive shortcut that a developer might write as a placeholder and never replace. The fix requires the candidate to **write an entire algorithm**, not change an operator or add a line.

The buggy code should look like something a developer wrote during initial development as a "get it working" stub — it compiles, runs, and produces output, but skips the full business logic. The candidate must replace the entire function body with a proper implementation.

**Pattern: Naive stub → Full algorithm**

| Buggy Code (Naive Stub) | What's Missing | Fix (Full Algorithm) |
|--------------------------|----------------|---------------------|
| `total = base_price * quantity` (1 line) | Dynamic pricing multiplier, service fees (12%), facility fees (5%), processing fee ($3), promo discounts | Multi-component pricing pipeline with tier lookup, per-ticket fee calculation, discount application (~20 lines) |
| `event.status = newStatus; await event.save()` (2 lines) | State machine validation, allowed transitions, prerequisite checks | Transition map + checks (sections exist before publish, past end_date before complete) (~22 lines) |
| `ticket.status = 'confirmed'; await ticket.save()` (2 lines) | Section counter transition, Redis hold cleanup, sold-out detection | Decrement held_count, increment sold_count, delete Redis key, check all sections full (~20 lines) |
| `refund = total_amount * 0.80` (1 line) | Time-based tiers, per-component fee rules, inventory restore, promo rollback | Tier calculation + fee decomposition + section/promo/ticket updates (~35 lines) |
| `Event.findOne({ venue_id, start_date: date })` (1 line) | Multi-day overlap detection, buffer periods, cancelled event exclusion | Range overlap query + buffer logic + exclusion filters + conflict details (~30 lines) |
| `Buffer.from(ticketId).toString('base64')` (1 line) | Cryptographic signing, ownership binding, scan tracking | HMAC-SHA256 token generation + verification + scan count (~30 lines) |
| Webhook reads `body.status`, updates payment directly (5 lines) | Signature verification, amount matching, idempotency, status state machine | Full HMAC check + amount verify + webhook log + state transitions (~45 lines) |
| `event.status = 'cancelled'; await event.save()` (2 lines) | Bulk refund cascade for all orders, inventory reset, promo rollback | Iterate orders + per-order refund with fee rules + counter reset + Redis cleanup (~50 lines) |
| Sequential `for` loop reserving sections (8 lines) | Transaction wrapping, atomic availability check, compensating rollback | MongoDB session + atomic findOneAndUpdate + rollback on failure (~45 lines) |

**Key principles:**
1. The buggy code must be **plausibly written** — it looks like a developer shortcut, not a deliberate sabotage
2. The buggy code must **produce output** — it returns a value, just the wrong one
3. The fix is **not a modification** of the buggy code — it's a **replacement** with an entirely new algorithm
4. A candidate who only reads the buggy code without understanding the business rules cannot fix it — they must understand the domain to write the correct implementation

### 6.4 Bug Research Process

When designing bugs, the LLM or author SHOULD:

1. **Research real-world occurrences** — search StackOverflow, Reddit r/node, GitHub issues for the bug pattern
2. **Verify it's a common pitfall** — not an obscure edge case nobody encounters
3. **Confirm testability** — design the test case BEFORE finalizing the bug
4. **Verify independence** — ensure fixing this bug doesn't accidentally fix another
5. **Document the root cause** — explain WHY this bug happens in practice (not just WHAT)

### 6.5 Cross-Application Uniqueness Rules

> **When creating multiple application specs (e.g., Equipment Rental + Event Ticketing), every bug must test a fundamentally different algorithmic pattern — not just the same bug with different variable names in a different domain.**

#### 6.5.1 What Constitutes a "Different Pattern"

Two bugs have the **same pattern** if:
- The buggy code has the same structural flaw (e.g., both use a flat rate instead of tiered pricing)
- The fix follows the same algorithmic approach (e.g., both add weekly/daily tier calculation)
- A candidate who solved one could apply the same fix pattern to the other with only variable name changes

Two bugs have **different patterns** if:
- The root cause is structurally different (e.g., missing fee pipeline vs. missing state machine vs. missing cryptographic signing)
- The fix requires a different algorithmic approach (e.g., multi-component aggregation vs. transition map enforcement vs. HMAC token generation)
- Understanding one fix gives no advantage in solving the other

#### 6.5.2 Uniqueness Verification Process

For each new bug in a new application spec:

1. **List the algorithmic pattern** — describe the fix in one sentence (e.g., "write a tiered pricing algorithm with weekly/daily rate lookup")
2. **Compare against ALL bugs in ALL other application specs** — does any existing bug require a fix with the same sentence-level description?
3. **If duplicate found** → redesign with a fundamentally different approach
4. **Document the difference** — each bug should include a "Uniqueness from [other spec]" statement explaining how it differs

#### 6.5.3 Cross-Application Pattern Registry

When maintaining multiple application specs, track which algorithmic patterns are already used:

| Pattern Category | Example Fix Pattern | Used In (Spec/Bug#) |
|-----------------|---------------------|---------------------|
| Tiered pricing by duration | Weekly/daily rate tiers based on rental length | Rental Bug 1 |
| Multi-component fee pipeline | Dynamic multiplier + service/facility fees + promo | Ticketing Bug 1 |
| Availability aggregation | Query related collections to subtract in-use from total | Rental Bug 2 |
| Counter state transition | Decrement one counter, increment another, cleanup Redis | Ticketing Bug 3 |
| State machine enforcement | Transition map with prerequisite checks | Ticketing Bug 2 |
| Recursive input sanitization | Deep traversal of nested objects to strip operators | Rental Bug 3 |
| Multi-rule validation + atomic | Business rule chain + atomic decrement | Rental Bug 4 |
| Fee decomposition on refund | Per-component refund rules + inventory restore | Ticketing Bug 4 |
| Cache key design + invalidation | Dynamic keys + TTL + mutation-triggered invalidation | Rental Bug 5 |
| Ownership transfer chain | Invalidate original + create replacement + audit trail | Ticketing Bug 5 |
| Scheduling overlap detection | Date range overlap query + buffer + exclusions | Rental Bug 6, Ticketing Bug 6 (different: maintenance vs. venue with buffer) |
| Authorization middleware | New middleware file + route integration | Rental Bug 7 |
| Cryptographic token generation | HMAC signing + ownership binding + scan tracking | Ticketing Bug 7 |
| TOCTOU / atomic reservation | findOneAndUpdate with conditions + transaction | Rental Bug 8 |
| Multi-resource transaction | MongoDB session wrapping multiple models + rollback | Ticketing Bug 10 |
| Idempotent job processing | Upsert + status reconciliation + duplicate detection | Rental Bug 9 |
| Webhook security | Signature verification + amount matching + idempotency | Ticketing Bug 8 |
| Single cancellation rollback | Undo side effects across 5 models for one record | Rental Bug 10 |
| Bulk cascade processing | Iterate all related records + per-record refund + inventory reset | Ticketing Bug 9 |

> **Rule of thumb:** If the one-sentence fix description for a new bug matches an existing entry in the registry, it's a duplicate pattern and must be redesigned.

#### 6.5.4 Common Duplication Traps

These pairs look different but are actually the same pattern — avoid them:

| Trap | App A Bug | App B Bug | Why It's the Same |
|------|-----------|-----------|-------------------|
| **"Flat rate → tiered"** | `days * daily_rate` → weekly/daily tiers | `price * quantity` → demand-based tiers | Both: lookup tier from input value, apply correct multiplier |
| **"Static cache key"** | Equipment listing cache ignores filters | Event listing cache ignores filters | Both: dynamic key generation + invalidation on mutation |
| **"Non-atomic counter"** | Coupon uses check-then-decrement | Seat reservation check-then-hold | Both: replace with atomic findOneAndUpdate |
| **"Missing rollback"** | Rental cancellation doesn't undo side effects | Event cancellation doesn't undo side effects | Both: iterate related models and undo changes |
| **"IDOR across endpoints"** | Rental detail/return/cancel have no ownership check | Order detail/refund/cancel have no ownership check | Both: add middleware with user_id filter |

**Correct approach:** If App A has "non-atomic coupon counter", App B should NOT have "non-atomic seat counter". Instead, App B should have a fundamentally different bug like "cryptographic token generation" or "date range overlap detection".

### 6.6 Bug Documentation Template

Every bug candidate MUST include the following sections in the application spec:

```markdown
### Bug N (Difficulty): Title

**Time:** ~XX-YY min | **Fix Size:** ~XX-YY lines | **Category:** X (from 6.1)
**Files:** file1.js (primary) + file2.js (if multi-file)
**Validates:** What skills/knowledge the candidate demonstrates

#### Description
2-3 paragraphs explaining: what the bug causes (symptoms), why it's hard to spot,
and what real-world scenarios it mirrors.

#### Symptom
What the candidate observes when running tests or using the API (incorrect values,
wrong status codes, unexpected behavior).

#### Buggy Code
The exact code the candidate receives (injected on the question branch).

#### Solution Code
The correct implementation (on the solution branch — answer key).

#### Test Cases (N)
Table with columns: #, Category, Test Name, Description, Key Assertion.
Each test case covers a different aspect (validation, core logic, edge cases, response structure).

#### Key Test Example
One representative test case as actual test code showing the most revealing assertion.

#### Independence
Brief statement confirming this bug doesn't interact with any other bug or feature code paths.

#### Uniqueness from [Other Spec] (if multiple application specs exist)
Brief statement explaining how this bug's algorithmic pattern differs from all bugs
in other application specs. Reference the specific bug it might be confused with.
```

---

## 7. Feature Design Rules

### 7.1 Feature Categories

#### Category A: New API Endpoint
- A complete new endpoint that doesn't exist in the codebase
- Route is registered but handler returns 501 or empty response
- Candidate must implement the full handler: validation, business logic, response

#### Category B: API Extension
- An existing endpoint needs additional functionality
- The endpoint works for basic cases but is missing logic for advanced scenarios
- Candidate must add helper functions, extend service methods, or add middleware

#### Category C: Data Processing / Aggregation
- Endpoints that require complex queries, aggregation pipelines, or computed results
- Often involves MongoDB aggregation framework or multi-step data transformations
- Examples: reports, analytics, summaries, time-based calculations

### 7.2 Feature Quality Requirements

| Requirement | Description |
|-------------|-------------|
| **Clear contract** | Exact request/response format documented. Candidate knows WHAT to build. |
| **Stub provided** | Function signature, route, and boilerplate exist. Candidate focuses on logic, not scaffolding. |
| **Testable** | Automated tests define the exact expected behavior. |
| **Builds on patterns** | Implementation follows the same conventions used in the rest of the codebase. |
| **Non-trivial** | Requires actual logic — not just a simple CRUD passthrough. |
| **Independent** | Feature lives in its own `features/` directory and doesn't interact with any bug code paths. |

### 7.3 Feature Documentation Template

Every feature candidate MUST include the following sections in the application spec:

```markdown
### Feature N (Difficulty): Title

**Time:** ~XX-YY min | **Area:** Category | **Implementation Size:** ~XX-YY lines
**Files:** `src/features/<feature_dir>/controller.js` + `src/features/<feature_dir>/routes.js`
**Validates:** What skills/knowledge the candidate demonstrates

#### Description
2-3 paragraphs explaining: what the feature does, why it's needed in the real world,
and what specific challenges the candidate will face implementing it.

#### Endpoint
Method, path, auth requirement.

#### Stub Code
The placeholder code the candidate receives (returns empty/placeholder response).

#### Solution Code
The complete working implementation (answer key — not visible to candidates).

#### Validation Rules
Table of input validations with condition, HTTP status, and error response.

#### Response Format
JSON example of the expected successful response.

#### Test Cases (N)
Table with columns: #, Category, Test Name, Description, Key Assertion.
Each test case covers a different aspect (validation, core logic, edge cases, response structure).

#### Key Test Example
One representative test case shown as actual test code (e.g., the most interesting core logic test).

#### Independence
Brief statement confirming this feature doesn't interact with any bug code paths or other features.
```

### 7.4 Feature Implementation Size Guidelines

| Difficulty | Lines | What the Implementation Involves |
|-----------|-------|----------------------------------|
| **Easy** | ~20-30 lines | Single query with validation, formatting, and response. Follows obvious existing patterns. |
| **Medium** | ~30-45 lines | Multi-step business logic: date math, tiered calculations, conflict detection, multiple validations. |
| **Hard** | ~45-60+ lines | Complex aggregation, date overlap algorithms, multi-collection joins, multi-dimensional grouping. |

---

## 8. Difficulty Matrix

> **Calibration note:** Since each task is a standalone HackerRank question (codebase-style), the candidate focuses entirely on ONE task. The difficulty must justify a full question — candidates should need to write a **substantial chunk of code** (not a one-line fix or operator change). Even "Easy" bugs require writing 15-25+ lines of new/rewritten logic.

### 8.1 Bug Difficulty

| Level | Time | Fix Size | Characteristics | Traversal | Example |
|-------|------|----------|----------------|-----------|---------|
| **Easy** | ~20-30 min | 15-25 lines | Bug requires rewriting a function body or implementing a missing validation pipeline. Candidate must understand the business context and write new logic — not just change a variable or operator. | 1-2 files | Availability computation missing entirely (returns raw total), cost calculation using wrong algorithm, sanitization middleware with fundamentally wrong approach |
| **Medium** | ~30-45 min | 25-40 lines | Bug spans multiple layers or requires understanding cross-component interaction. Fix involves writing new middleware, restructuring a service function, or implementing a multi-step validation flow. | 2-3 files | Coupon validation with no business rules + non-atomic usage, cache with wrong key design + no invalidation across mutations, authorization middleware missing from multiple endpoints |
| **Hard** | ~45-60 min | 35-50+ lines | Bug requires architectural restructuring — adding transactions, implementing idempotency patterns, writing multi-model rollback logic, or redesigning a concurrent workflow. Multiple valid approaches exist. | 3-5 files | Race condition requiring MongoDB transactions, payment processor needing idempotency redesign, cancellation flow with multi-model side effect rollback |

### 8.2 Feature Difficulty

| Level | Time | Implementation Size | Characteristics | Example |
|-------|------|-------------------|----------------|---------|
| **Easy** | ~20-30 min | 20-35 lines | Single endpoint with query logic, validation, and response formatting. Follows existing patterns but requires understanding the data model. | Search endpoint with regex + aggregation, filtered listing with computed fields |
| **Medium** | ~30-45 min | 35-55 lines | Business logic with date math, tiered calculations, multiple validations, and edge cases. May require querying across multiple collections. | Cost estimator with tiered pricing + coupon preview, availability calendar for date range |
| **Hard** | ~45-60 min | 50-80+ lines | Complex aggregation pipeline, time-based overlap calculations, multi-step data processing with edge cases, and computed metrics. | Utilization report with date overlaps and revenue aggregation, fleet analytics with seasonal trends |

---

## 9. Testing Rules

### 9.1 Critical Principle

> **Every task MUST be testable via automated test cases. Tests are the ONLY mechanism for scoring candidate performance.**

If a task cannot be expressed as a pass/fail test assertion, it is NOT a valid task.

### 9.2 Test Structure: Multiple Test Cases Per Question

> **Each question (bug or feature) has MULTIPLE test cases** covering different aspects of the expected behavior. This is how HackerRank scores candidates — each test case is a separate pass/fail point.

#### Test Case Organization

Test cases for a single question are organized into **categories**, each covering a different aspect:

| Category | Purpose | Typical Count |
|----------|---------|--------------|
| **Validation** | Input validation, error handling, edge cases (missing params, invalid formats, empty values) | 3-5 tests |
| **Core Logic** | Happy path variations testing the main fix/implementation at different states | 3-5 tests |
| **Authorization** | Access control, cross-user isolation, ownership checks | 1-2 tests |
| **Response Structure** | Required fields present, correct types, response format compliance | 1 test |
| **Edge Cases** | Boundary conditions, concurrent operations, empty data sets | 1-3 tests |

**Target: 8-12 test cases per question** (varies by difficulty):
- Easy: 6-8 test cases
- Medium: 8-10 test cases
- Hard: 10-12 test cases

#### Test Naming Convention

Tests use sequential numbering with descriptive names:

```
test_{category}_{number}_{description}
```

Examples from a single question:
```javascript
// Validation tests
test_validation_01_account_not_found         // 404 for non-existent resource
test_validation_02_timestamp_required        // 400 for missing required param
test_validation_03_invalid_timestamp_format  // 400 for malformed input
test_validation_04_empty_timestamp           // 400 for empty string

// Core logic tests
test_balance_05_before_any_transactions      // Zero state
test_balance_06_after_first_transaction      // Single operation
test_balance_07_mid_month                    // Partial period
test_balance_08_end_of_period               // Full period

// Authorization tests
test_authorization_09_cross_user_blocked     // IDOR prevention

// Response structure tests
test_response_structure_10_contains_all_required_fields  // Contract validation
```

#### Test File Structure

Each question has its own test file(s):

```
tests/
  bug_01_tiered_pricing.test.js        # All test cases for Bug 1
  bug_02_availability.test.js          # All test cases for Bug 2
  feat_01_equipment_search.test.js     # All test cases for Feature 1
  helpers/
    setup.js                           # DB + Redis setup/teardown
    factory.js                         # Test data factories
```

Each test file contains:
1. **Fixture setup** — test data created in `before()` / `beforeEach()` hooks
2. **Multiple `describe` blocks** — grouped by test category
3. **Sequential `it` blocks** — numbered test cases
4. **Teardown** — clean state between tests

### 9.3 Test Design Requirements

| Requirement | Description |
|-------------|-------------|
| **Multi-case** | Each question has 6-12 test cases covering validation, core logic, authorization, structure, and edge cases. |
| **Deterministic** | Tests must produce the same result every run. No flaky tests. |
| **Independent** | Tests don't depend on each other. Each test has clean setup/teardown. |
| **Clear assertions** | Tests check specific values, status codes, and response shapes. |
| **Dynamic data** | Test data should be generated programmatically, not hardcoded (anti-cheat). |
| **Descriptive names** | Test names describe the expected behavior, guiding the candidate. |
| **Sequential numbering** | Test cases numbered `01_*` through `N_*` for specification matching. |

### 9.4 Test Patterns for Each Bug Category

#### Race Conditions
```javascript
it('should not allow double-booking for concurrent requests', async () => {
    // Setup: equipment with 1 available unit
    // Action: fire 2 rental requests simultaneously via Promise.all
    const [res1, res2] = await Promise.all([
        request(app).post('/api/v1/rentals').send(rentalData).set('Authorization', token),
        request(app).post('/api/v1/rentals').send(rentalData).set('Authorization', token)
    ]);
    // Assert: exactly one succeeds (201), one fails (409/400)
    const statuses = [res1.status, res2.status].sort();
    expect(statuses).to.deep.equal([201, 409]);
    // Verify only 1 rental exists in DB
    const count = await Rental.countDocuments({ equipment_id: equipmentId });
    expect(count).to.equal(1);
});
```

#### NoSQL Injection
```javascript
it('should not allow NoSQL injection in login', async () => {
    // Attempt to bypass auth with MongoDB operator injection
    const res = await request(app).post('/api/v1/auth/login').send({
        email: { "$gt": "" },     // Matches any non-empty email
        password: { "$gt": "" }   // Matches any non-empty password
    });
    expect(res.status).to.equal(400); // Should reject, not authenticate
});
```

#### Validation Errors
```javascript
it('should reject rental with negative duration', async () => {
    const res = await request(app).post('/api/v1/rentals').send({
        equipment_id: equipmentId,
        start_date: '2024-03-15T00:00:00Z',
        end_date: '2024-03-10T00:00:00Z'   // End BEFORE start
    }).set('Authorization', token);
    expect(res.status).to.equal(400);
    expect(res.body.error).to.include('end_date');
});
```

#### Authorization Flaws (IDOR)
```javascript
it('should not allow User A to access User B rental', async () => {
    // Setup: User B creates a rental
    const rental = await createRentalAs(userB);
    // Action: User A tries to access it
    const res = await request(app)
        .get(`/api/v1/rentals/${rental._id}`)
        .set('Authorization', userAToken);
    expect(res.status).to.equal(404); // Not 200 — prevent enumeration
});
```

#### Data Integrity
```javascript
it('should correctly calculate total after return with late fee', async () => {
    // Setup: rental with known dates and rates
    // Action: return equipment late
    const res = await request(app).patch(`/api/v1/rentals/${rentalId}/return`).send({
        actual_return_date: lateDate
    }).set('Authorization', token);
    // Assert: exact expected values computed from inputs
    const expectedBase = rentalDays * dailyRate;
    const expectedLateFee = lateDays * dailyRate * 1.5;
    expect(res.body.total_cost).to.equal(expectedBase + expectedLateFee);
    expect(res.body.late_fee).to.equal(expectedLateFee);
});
```

### 9.5 Test Output Format

Tests must produce dual output:
1. **Terminal:** Human-readable (spec reporter) for development
2. **XML:** JUnit format in `unit.xml` for HackerRank scoring

```json
// config.json
{
  "reporterEnabled": "spec, mocha-junit-reporter",
  "mochaJunitReporterReporterOptions": {
    "mochaFile": "unit.xml"
  }
}
```

### 9.6 Test Anti-Cheat

- Test data MUST be generated dynamically (random values, computed expectations)
- Tests MUST NOT contain hardcoded expected values that can be reverse-engineered
- Test files are READONLY in the HackerRank sandbox (candidates cannot modify them)

---

## 10. Independence & Scoring

### 10.1 Independence Guarantee (Codebase-Style)

> In codebase-style questions, independence is **naturally guaranteed** because each task lives in its own codebase copy. However, you still need to verify that the same base application can host any single defect without affecting unrelated functionality.

| Rule | Description |
|------|-------------|
| **1:N Mapping** | Each task has a **test group** (6-12 test cases). All test cases in the group fail on the question branch; all pass after the fix. |
| **No Cascading** | Fixing Task A must NEVER fix Task B. |
| **Any Order** | Candidates can solve tasks in any sequence. |
| **Isolated State** | Each test sets up its own data and cleans up. No shared mutable state between tests. |

### 10.2 Scoring Model

```
Score = (number_of_passing_tests / total_tests) * 100
```

- Each test has equal weight
- Partial credit: solving 4 out of 6 tasks = 66.7%
- All-or-nothing per task: a test either passes or fails

### 10.3 Verification Checklist

Before finalizing any challenge:

**Per-question verification (codebase-style):**
- [ ] Solution branch: ALL tests pass
- [ ] Each question branch: its own test(s) fail, all OTHER tests pass (since only one defect is injected)
- [ ] Application starts on ALL branches without crashing
- [ ] The injected defect ONLY causes that question's test(s) to fail — no collateral damage
- [ ] No TODO/FIXME/BUG comments in question branch (except `/* YOUR CODE HERE */` for features)
- [ ] No linter configurations that could reveal bugs
- [ ] The fix requires writing **substantial code** (not a one-line change)

---

## 11. Anti-Patterns

### 11.1 What Tasks MUST NOT Be

| Anti-Pattern | Why It's Bad |
|-------------|-------------|
| **Syntax errors** (missing brackets, typos) | Tests code reading, not debugging |
| **Missing imports** | Trivial, no reasoning required |
| **Simple operator swaps** (`>` vs `>=`) | Too easy, doesn't test real debugging skills |
| **One-character fixes** | Pattern matching, not understanding |
| **Code formatting issues** | Style, not logic |
| **Errors that crash on startup** | Candidate can't even explore the app |
| **Cascading failures** (fixing A fixes B) | Unfair scoring |
| **Hardcoded test expectations** | Enables cheating |
| **Unrealistic/contrived bugs** | Doesn't evaluate practical skills |
| **Bugs only detectable by reading, not testing** | Cannot be scored automatically |
| **Domain-renamed duplicates across specs** | If App A has "flat rate → tiered pricing" and App B has "flat price → demand tiers", it's the same pattern with different variable names |
| **Correct code with wrong operator** | `>` vs `>=`, `$gte` vs `$gt` — these are seconds-to-fix operator swaps, not real debugging challenges |
| **Correct algorithm missing one step** | Adding one `await Model.updateOne()` line is not a substantial fix — the candidate must write an entire algorithm |

### 11.2 What the Codebase MUST NOT Contain (Question Branch)

- No `TODO`, `FIXME`, `BUG`, `HACK`, `XXX` comments (except `/* YOUR CODE HERE */` for features)
- No linter configs (`.eslintrc`, `.prettierrc`) that could highlight issues
- No `*.md` files in the source directories (documentation at root only)
- No commented-out solution code
- No variable names hinting at the bug (`wrongValue`, `shouldBeX`)

---

## 12. Research Process

### 12.1 Bug Research Workflow

When designing a new bug for a task:

1. **Identify the category** — pick from Section 6.1 categories
2. **Research real occurrences:**
   - Search StackOverflow: `"[node.js] [mongodb] race condition"`, `"express validation bypass"`
   - Search Reddit: `r/node`, `r/webdev`, `r/javascript` for "production bug", "learned hard way"
   - Search GitHub: issues in popular Express/Mongoose repos
   - Search blogs: post-mortems, "lessons learned" articles
3. **Verify testability** — write the test case FIRST, then design the bug
4. **Verify subtlety** — show the buggy code to someone; if they spot it in <30 seconds, it's too obvious
5. **Verify fix complexity** — the fix must require writing **15-50+ lines of new algorithmic code**, not changing an operator or adding a single line. The buggy code should be a "naive stub" (see Section 6.3.1) that the candidate must replace entirely
6. **Verify independence** — map out which code paths are affected
7. **Verify cross-application uniqueness** — compare the bug's algorithmic pattern against ALL bugs in ALL other application specs using the pattern registry (see Section 6.5.3). If the one-sentence fix description matches an existing bug, redesign with a fundamentally different approach
8. **Document everything** — root cause, symptom, fix, test, real-world reference, uniqueness from other specs

### 12.2 Feature Research Workflow

1. **Identify the gap** — what's missing from the existing API that a real application would need?
2. **Define the contract** — exact request format, response format, status codes, error messages
3. **Design the test first** — what assertions prove the feature works?
4. **Design the stub** — what boilerplate does the candidate get for free?
5. **Verify difficulty** — estimate time to implement based on the logic required

---

## 13. Documentation Template

Every application challenge MUST include this documentation:

### 13.1 Application Spec (SPEC.md)

```markdown
# [Application Name] — Specification

## Application Overview
- Domain description
- Core business flows
- Tech stack

## Data Models
- All entities with fields, types, constraints
- Relationships between models
- Status lifecycles / state machines

## API Endpoints
- Full endpoint list with method, path, auth, description
- Request/response formats for each
- Error responses with status codes

## Tasks
For each task:
- Task number, type (bug/feature), difficulty
- Description (what the candidate observes / needs to implement)
- Root cause (for bugs — SOLUTION.md only, not visible to candidates)
- Test scenario (how the test validates the fix/implementation)
- Test code example
- Independence verification (what other tasks are NOT affected)
```

### 13.2 Candidate Instructions (QUESTION.md)

What the candidate sees:
- Application description (business context)
- Setup instructions (`npm install && npm test`)
- Symptoms / requirements described by BEHAVIOR only
- No file paths, no line numbers, no hints
- "Make all tests pass"

### 13.3 Evaluator Guide (SOLUTION.md)

What the evaluator sees:
- Complete list of all tasks with locations (file:line)
- Before/after code diffs
- Evaluation rubric
- Test-to-task mapping
- Expected time per task

---

## 14. Real-World Bug Examples (Research-Backed)

The following examples are drawn from StackOverflow, GitHub issues, Reddit, OWASP, and production incident reports. Use these as inspiration when designing bug tasks.

### 14.1 Race Conditions (Concurrent Requests)

**Double-Booking / Inventory Overselling:**
Two concurrent requests both read `stock: 1`, both pass the check, both decrement. Final stock = -1.

```javascript
// BUG: Read-then-write without atomicity
async function createRental(equipmentId) {
    const equipment = await Equipment.findById(equipmentId);
    if (equipment.status !== 'available') throw new Error('Not available');
    equipment.status = 'rented';       // If two requests read 'available' simultaneously...
    await equipment.save();            // ...both will write 'rented' — double booking!
}

// FIX: Atomic update with conditions
async function createRentalSafe(equipmentId) {
    const result = await Equipment.findOneAndUpdate(
        { _id: equipmentId, status: 'available' },  // Condition + update in one atomic op
        { $set: { status: 'rented' } },
        { new: true }
    );
    if (!result) throw new Error('Not available');
    return result;
}
```

**Test pattern:** Fire concurrent requests via `Promise.all`, verify exactly one succeeds:
```javascript
const [res1, res2] = await Promise.all([
    request(app).post('/rentals').send(data).set('Authorization', token),
    request(app).post('/rentals').send(data).set('Authorization', token)
]);
const statuses = [res1.status, res2.status].sort();
expect(statuses).to.deep.equal([201, 409]); // Exactly one success
```

**Sources:** Common in booking systems, e-commerce. StackOverflow: "MongoDB concurrent writes race condition"

---

### 14.2 NoSQL Injection

**MongoDB Operator Injection:**
User sends `{ email: { "$gt": "" } }` instead of a string. MongoDB matches ANY non-empty email.

```javascript
// BUG: Direct user input in query
const user = await User.findOne({ email: req.body.email, password: hash });
// If req.body.email = { "$gt": "" }, this matches the first user!

// FIX: Validate types before querying
if (typeof req.body.email !== 'string' || typeof req.body.password !== 'string') {
    return res.status(400).json({ error: 'Invalid input' });
}
```

**Test pattern:** Send objects instead of strings in request body:
```javascript
const res = await request(app).post('/auth/login').send({
    email: { "$gt": "" },
    password: { "$gt": "" }
});
expect(res.status).to.equal(400); // Must reject, not authenticate
```

**Sources:** OWASP NoSQL Injection, numerous CVEs. StackOverflow: "MongoDB query injection"

---

### 14.3 IDOR (Insecure Direct Object Reference)

**Broken Access Control:**
User A can access User B's data by changing the ID in the URL.

```javascript
// BUG: No ownership check
app.get('/rentals/:id', auth, async (req, res) => {
    const rental = await Rental.findById(req.params.id); // Any user can see ANY rental
    res.json(rental);
});

// FIX: Filter by authenticated user
app.get('/rentals/:id', auth, async (req, res) => {
    const rental = await Rental.findOne({ _id: req.params.id, userId: req.user.id });
    if (!rental) return res.status(404).json({ error: 'Not found' });
    res.json(rental);
});
```

**Test pattern:** Create data as User B, access as User A:
```javascript
const rental = await createRentalAs(userB);
const res = await request(app).get(`/rentals/${rental._id}`).set('Authorization', userAToken);
expect(res.status).to.equal(404); // Not 200
```

**Sources:** OWASP API Top 10 #1. StackOverflow: "How to prevent IDOR in Node.js"

---

### 14.4 Lost Updates (Concurrent .save())

**Two concurrent requests overwrite each other:**

```javascript
// BUG: Full document save overwrites concurrent changes
async function updateName(userId, name) {
    const user = await User.findById(userId);
    user.name = name;
    await user.save(); // Overwrites email change if it happened concurrently
}

// FIX: Atomic field update
async function updateNameSafe(userId, name) {
    await User.updateOne({ _id: userId }, { $set: { name } });
}
```

**Test pattern:** Fire concurrent field updates, verify all fields preserved:
```javascript
await Promise.all([
    request(app).put(`/user/${id}/name`).send({ name: "New Name" }),
    request(app).put(`/user/${id}/email`).send({ email: "new@test.com" })
]);
const user = await User.findById(id);
expect(user.name).to.equal("New Name");
expect(user.email).to.equal("new@test.com"); // Lost with buggy .save()
```

**Sources:** Mongoose docs: `.save()` vs `updateOne()`. StackOverflow: "Mongoose save concurrent changes"

---

### 14.5 Late Return Cost Double-Counting

**Multi-step calculation where late days are charged twice:**

```javascript
// BUG: Base cost includes late days, late fee ALSO charges for them
function calculateTotal(rental, actualReturn) {
    const baseDays = (actualReturn - rental.startDate) / DAY;  // Includes late days!
    const baseCost = baseDays * rental.dailyRate;
    const lateDays = Math.max(0, (actualReturn - rental.endDate) / DAY);
    const lateFee = lateDays * rental.dailyRate * 1.5;
    return baseCost + lateFee; // Late days counted twice
}

// FIX: Cap base cost at planned period
function calculateTotalSafe(rental, actualReturn) {
    const baseDays = (rental.endDate - rental.startDate) / DAY;  // Only planned period
    const baseCost = baseDays * rental.dailyRate;
    const lateDays = Math.max(0, (actualReturn - rental.endDate) / DAY);
    const lateFee = lateDays * rental.dailyRate * 1.5;
    return baseCost + lateFee;
}
```

**Test pattern:** Return late, verify exact total matches expected formula.

---

### 14.6 JWT Algorithm Confusion

**Server accepts `alg: "none"` unsigned tokens:**

```javascript
// BUG: No algorithm restriction
req.user = jwt.verify(token, SECRET); // Accepts "none" algorithm!

// FIX: Specify allowed algorithms
req.user = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
```

**Test pattern:** Craft unsigned token with `alg: "none"`, verify rejection.

**Sources:** CVE-2015-9235. Auth0: "Critical JWT vulnerabilities"

---

### 14.7 Error Details Leaked to Client

**Stack traces and internal paths in API responses:**

```javascript
// BUG: Sending full error to client
res.status(500).json({ error: err.message, stack: err.stack });

// FIX: Generic message + server-side logging
console.error('Internal error:', err);
res.status(500).json({ error: 'Internal server error' });
```

**Test pattern:** Trigger an error, verify response doesn't contain stack traces or file paths:
```javascript
expect(res.body.stack).to.be.undefined;
expect(JSON.stringify(res.body)).to.not.match(/\/[a-z]+\/.*\.js/i);
```

---

### 14.8 MongoDB Aggregation Pipeline Order

**$match after $group scans entire collection:**

```javascript
// BUG: Match after group — processes ALL documents
const result = await Transaction.aggregate([
    { $group: { _id: "$userId", total: { $sum: "$amount" } } },
    { $match: { _id: targetUserId } }  // Filters AFTER grouping everyone
]);

// FIX: Match before group — filters first
const result = await Transaction.aggregate([
    { $match: { userId: targetUserId } },  // Filter first
    { $group: { _id: "$userId", total: { $sum: "$amount" } } }
]);
```

**Sources:** MongoDB performance docs. StackOverflow: "MongoDB aggregation slow"

---

### 14.9 TOCTOU (Time-of-Check to Time-of-Use)

**Coupon validated in step 1, used in step 2 — but another user uses it between steps:**

```javascript
// BUG: Separate check and use
const coupon = await Coupon.findOne({ code, usesRemaining: { $gt: 0 } });
if (!coupon) return res.status(400).json({ error: 'Invalid' });
// ... other logic ...
await Coupon.updateOne({ _id: coupon._id }, { $inc: { usesRemaining: -1 } });
// usesRemaining can go negative!

// FIX: Atomic check-and-decrement
const coupon = await Coupon.findOneAndUpdate(
    { code, usesRemaining: { $gt: 0 } },
    { $inc: { usesRemaining: -1 } },
    { new: true }
);
if (!coupon) return res.status(400).json({ error: 'No longer available' });
```

**Test pattern:** 10 concurrent requests for a coupon with `usesRemaining: 1`, verify exactly 1 gets the discount.

---

## Appendix: Quick Reference

### Bug Design Checklist
- [ ] Falls into a real-world category (Section 6.1)
- [ ] Based on researched real occurrences
- [ ] Non-trivial to find (requires reasoning)
- [ ] Syntactically valid, no crashes
- [ ] Buggy code uses the "naive stub" pattern (Section 6.3.1) — a plausible but incomplete implementation, NOT correct code with a wrong operator
- [ ] Fix requires writing a **complete algorithm** (15-50+ lines), not modifying existing code
- [ ] Independent from all other tasks within the same application spec
- [ ] Algorithmically unique from all bugs in OTHER application specs (Section 6.5) — not a domain-renamed duplicate
- [ ] Subtle — code looks plausible (like a developer shortcut)
- [ ] Validates knowledge — tests candidate competency in that area

**Documentation completeness:**
- [ ] Description with symptom + root cause + real-world reference
- [ ] Buggy code (what candidate receives — naive stub)
- [ ] Solution code (answer key — full algorithm)
- [ ] Test cases table (6-12 cases with categories)
- [ ] Key test example (code)
- [ ] Independence analysis (within same application spec)
- [ ] Uniqueness statement (from other application specs, if applicable)

### Feature Design Checklist
- [ ] Clear API contract (endpoint, auth, request/response/errors)
- [ ] Stub provided with route registered
- [ ] Non-trivial logic required (20-60+ lines)
- [ ] Follows existing codebase patterns
- [ ] Independent from all other tasks and bug code paths
- [ ] Lives in `features/` directory (isolated from core app code)

**Documentation completeness:**
- [ ] Description with real-world context
- [ ] Endpoint definition (method, path, auth)
- [ ] Stub code (placeholder response)
- [ ] Solution code (answer key)
- [ ] Validation rules table (condition, status, error response)
- [ ] Response format (JSON example)
- [ ] Test cases table (7-12 cases with categories)
- [ ] Key test example (code)
- [ ] Independence analysis
