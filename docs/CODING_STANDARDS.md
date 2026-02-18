# EquipRent — Coding Standards & Style Guide

> Derived from deep analysis of the reference repository: `coderepo-mern-linear-clone/backend`
> This document is the single source of truth for all code written in the EquipRent project.

---

## Table of Contents

1. [Folder Structure](#1-folder-structure)
2. [File Naming Conventions](#2-file-naming-conventions)
3. [Module System & Exports](#3-module-system--exports)
4. [Application Bootstrap](#4-application-bootstrap)
5. [Controller Patterns](#5-controller-patterns)
6. [Service Patterns](#6-service-patterns)
7. [Model Patterns](#7-model-patterns)
8. [Middleware Patterns](#8-middleware-patterns)
9. [Route Patterns](#9-route-patterns)
10. [Error Handling Architecture](#10-error-handling-architecture)
11. [Query & Database Patterns](#11-query--database-patterns)
12. [Utility Patterns](#12-utility-patterns)
13. [Test Case Standards](#13-test-case-standards)
14. [Response Format Standards](#14-response-format-standards)
15. [Quick Reference Cheat Sheet](#15-quick-reference-cheat-sheet)

---

## 1. Folder Structure

```
backend/
├── src/
│   ├── config/                     # Configuration (DB, Redis, env, Swagger)
│   │   ├── env.js
│   │   ├── db.js
│   │   ├── redis.js
│   │   └── swagger.js
│   ├── controllers/                # Thin request handlers
│   │   ├── auth.controller.js
│   │   ├── equipment.controller.js
│   │   └── ...
│   ├── middleware/                  # Express middleware
│   │   ├── auth.js
│   │   ├── ownership.js
│   │   ├── errorHandler.js
│   │   └── sanitize.js
│   ├── models/                     # Mongoose schemas & models
│   │   ├── User.js
│   │   ├── Equipment.js
│   │   └── ...
│   ├── routes/                     # Express route definitions
│   │   ├── index.js
│   │   ├── auth.routes.js
│   │   └── ...
│   ├── services/                   # Business logic layer
│   │   ├── auth.service.js
│   │   ├── rental.service.js
│   │   └── ...
│   ├── jobs/                       # Background job processors
│   │   ├── queue.js
│   │   └── payment.processor.js
│   ├── utils/                      # Helpers & shared utilities
│   │   ├── AppError.js
│   │   ├── helpers.js
│   │   └── softDelete.plugin.js
│   ├── app.js                      # Express app setup
│   └── server.js                   # Entry point (boot + listen)
├── test/                           # Test suites
│   ├── task1/app.spec.js
│   ├── task2/app.spec.js
│   └── ...
├── docs/                           # Documentation
├── package.json
└── .env
```

**Rules:**
- Flat file structure per layer (no domain subdirectories in controllers/routes)
- Services may have domain subdirectories if complexity warrants it
- Models are PascalCase singular (`User.js`, `Equipment.js`)
- All other files are camelCase or kebab-case

---

## 2. File Naming Conventions

| Layer | Pattern | Example |
|-------|---------|---------|
| **Controllers** | `<entity>.controller.js` | `auth.controller.js` |
| **Services** | `<entity>.service.js` | `rental.service.js` |
| **Models** | `<Entity>.js` (PascalCase) | `Equipment.js` |
| **Routes** | `<entity>.routes.js` | `equipment.routes.js` |
| **Middleware** | `<name>.js` (descriptive) | `auth.js`, `errorHandler.js` |
| **Utils** | `<name>.js` (descriptive) | `AppError.js`, `helpers.js` |
| **Config** | `<name>.js` (descriptive) | `db.js`, `redis.js` |
| **Tests** | `app.spec.js` inside task dirs | `test/task1/app.spec.js` |

---

## 3. Module System & Exports

**ES Modules** (`"type": "module"` in package.json)

### Export Rules

| File Type | Export Style | Example |
|-----------|-------------|---------|
| **Controllers** | Named exports per function | `export const register = async (req, res) => { ... }` |
| **Services** | Named exports per function | `export const createRental = async (data) => { ... }` |
| **Models** | Named export (single) | `export const User = mongoose.model('User', schema)` |
| **Middleware** | Named export (single) | `export const auth = async (req, res, next) => { ... }` |
| **Routes** | Named export (single) | `export const router = Router()` |
| **Config** | Named export (single) | `export const config = { ... }` |
| **Utils** | Named exports | `export class AppError extends Error { ... }` |
| **app.js** | Named export | `export const app = express()` |

### Import Rules

```javascript
// Models — named import
import { User } from '../models/User.js';

// Services in controllers — namespace import (avoids naming conflicts)
import * as rentalService from '../services/rental.service.js';

// Services in services — namespace or named import
import * as cacheService from './cache.service.js';

// Middleware — named import
import { auth } from '../middleware/auth.js';

// Config — named import
import { config } from '../config/env.js';

// Routes in index.js — named import with alias (all export `router`)
import { router as authRoutes } from './auth.routes.js';

// Error classes — named import (pick what you need)
import { BadRequestError, NotFoundError } from '../utils/AppError.js';

// App — named import
import { app } from './app.js';
```

**NEVER use `export default` anywhere. All exports are named.**

---

## 4. Application Bootstrap

### app.js Pattern

```javascript
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import { router as routes } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sanitize } from './middleware/sanitize.js';

export const app = express();

// 1. Body parsing
app.use(express.json());
app.use(cors());

// 2. Global middleware
app.use(sanitize);

// 3. Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// 4. Routes
app.use('/api/v1', routes);

// 5. Error handler (MUST be last)
app.use(errorHandler);
```

### server.js Pattern

```javascript
import { app } from './app.js';
import { config } from './config/env.js';
import { connectDB } from './config/db.js';

const start = async () => {
  await connectDB();
  app.listen(config.port, () => {
    console.log(`Server running on port ${config.port}`);
  });
};

start();
```

**Key Rules:**
- Express 5 handles async errors natively — no `express-async-errors` needed
- Error handler middleware is ALWAYS last
- DB connection happens before server listen
- Test mode: do NOT start server or connect DB in app.js

---

## 5. Controller Patterns

### Structure

```javascript
import * as rentalService from '../services/rental.service.js';

// Thin handler: extract → call service → respond
export const createRental = async (req, res) => {
  const userId = req.user._id;
  const data = req.body;
  const rental = await rentalService.createRental(userId, data);
  res.status(201).json({ rental });
};

export const getUserRentals = async (req, res) => {
  const userId = req.user._id;
  const rentals = await rentalService.getUserRentals(userId);
  res.json({ rentals });
};

export const getRentalById = async (req, res) => {
  const { id } = req.params;
  const rental = await rentalService.getRentalById(id);
  res.json({ rental });
};
```

### Controller Rules

1. **Arrow functions**: `export const fn = async (req, res) => { ... }`
2. **NO try/catch**: Express 5 catches async errors automatically
3. **Thin layer**: Only extract from req, call service, return response
4. **No business logic**: No validation, no DB queries, no conditionals beyond extraction
5. **Services via namespace import**: `import * as xService from '...'`
6. **Status codes**: 200 (default), 201 (create), others via service errors
7. **Response wrapping**: Always wrap in object: `{ rental }`, `{ rentals }`, `{ message }`

---

## 6. Service Patterns

### Structure

```javascript
import { Equipment } from '../models/Equipment.js';
import { BadRequestError, NotFoundError } from '../utils/AppError.js';

export const createEquipment = async (data) => {
  // 1. Validate input
  if (!data.name || !data.category_id) {
    throw new BadRequestError('Name and category are required');
  }

  // 2. Business logic checks
  const existing = await Equipment.findOneActive({ name: data.name });
  if (existing) {
    throw new BadRequestError('Equipment with this name already exists');
  }

  // 3. Create & save
  const equipment = new Equipment({ ...data });
  await equipment.save();

  // 4. Post-actions (cache invalidation, activity logging, etc.)
  await cacheService.invalidateEquipmentCache();

  // 5. Return result
  return equipment;
};
```

### Service Rules

1. **Named exports**: `export const fn = async (...) => { ... }`
2. **Validation first**: Check required fields before any DB operations
3. **Error subclasses only**: `throw new NotFoundError('...')`, never `throw new AppError('...', 404)`
4. **No try/catch**: Unless wrapping external calls (e.g., payment processors, transactions)
5. **Contains ALL business logic**: Validation, authorization checks, state transitions, calculations
6. **Private helpers**: Internal functions (not exported) for reusable logic within the file
7. **Return values**: Return the created/updated document or structured result objects

### Error Throwing Pattern

```javascript
// Good — specific error subclass
throw new NotFoundError('Equipment not found');
throw new BadRequestError('end_date must be after delivery_date');
throw new ConflictError('Equipment is not available');
throw new UnauthorizedError('Invalid credentials');

// Bad — generic AppError
throw new AppError('Equipment not found', 404);  // NEVER do this
```

### Validation Patterns

```javascript
// Required fields
if (!title || !teamId) {
  throw new BadRequestError('Title and team are required');
}

// String content validation
if (!content || !content.trim()) {
  throw new BadRequestError('Content is required');
}

// Business rule validation
if (endDate <= deliveryDate) {
  throw new BadRequestError('end_date must be after delivery_date');
}

// State validation
if (rental.status !== 'pending') {
  throw new BadRequestError('Only pending rentals can be cancelled');
}

// Ownership check (authorization in service)
if (comment.user.toString() !== userId.toString()) {
  throw new ForbiddenError('Not authorized');
}
```

---

## 7. Model Patterns

### Structure

```javascript
import mongoose from 'mongoose';
import { softDeletePlugin } from '../utils/softDelete.plugin.js';

// Export enum constants for use in services/validation
export const RENTAL_STATUSES = ['pending', 'active', 'completed', 'cancelled', 'overdue'];

const rentalSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    equipment_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Equipment',
      required: true,
    },
    status: {
      type: String,
      enum: RENTAL_STATUSES,
      default: 'pending',
    },
    daily_rate: {
      type: Number,
      required: true,
    },
    notes: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

// Indexes
rentalSchema.index({ user_id: 1, status: 1 });
rentalSchema.index({ equipment_id: 1, status: 1 });

// Plugins
rentalSchema.plugin(softDeletePlugin);

// Static methods
rentalSchema.statics.findByUser = function (userId) {
  return this.findActive({ user_id: userId });
};

// Instance methods
rentalSchema.methods.isOverdue = function () {
  return this.status === 'active' && new Date() > this.end_date;
};

export const Rental = mongoose.model('Rental', rentalSchema);
```

### Model Rules

1. **Named export**: `export const ModelName = mongoose.model(...)`
2. **Timestamps**: Always enabled (`{ timestamps: true }` or mapped to snake_case)
3. **Enum constants**: Export as named constants for reuse: `export const STATUSES = [...]`
4. **References**: `type: mongoose.Schema.Types.ObjectId, ref: 'ModelName'`
5. **Indexes**: Defined on frequently queried field combinations
6. **Soft delete plugin**: Applied where applicable
7. **Schema validation**: `required`, `unique`, `enum`, `trim`, `lowercase`, `match`, `min`/`max`
8. **Static methods**: For custom queries (`findByEmail`, etc.)
9. **Instance methods**: For computed properties or transformations (`toPublicProfile`, etc.)

---

## 8. Middleware Patterns

### Authentication Middleware

```javascript
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { config } from '../config/env.js';
import { UnauthorizedError } from '../utils/AppError.js';

export const auth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    throw new UnauthorizedError('Authentication required');
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwtSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Token expired');
    }
    throw new UnauthorizedError('Invalid token');
  }

  const user = await User.findById(decoded.userId);
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  req.user = user;
  next();
};
```

### Middleware Rules

1. **Throw error subclasses**: Never `res.status(401).json(...)` — always `throw new UnauthorizedError(...)`
2. **Named export**: `export const middleware = (req, res, next) => { ... }`
3. **Async where needed**: Use `async` if doing DB lookups
4. **Attach to req**: `req.user = user` for downstream handlers
5. **Call next()**: On success, always call `next()`

---

## 9. Route Patterns

### Structure

```javascript
import { Router } from 'express';
import { createRental, getUserRentals, getRentalById } from '../controllers/rental.controller.js';
import { auth } from '../middleware/auth.js';
import { requireRentalOwnership } from '../middleware/ownership.js';

export const router = Router();

router.post('/', auth, createRental);
router.get('/', auth, getUserRentals);
router.get('/:id', auth, requireRentalOwnership, getRentalById);
```

### Route Index (Mounting)

```javascript
import { Router } from 'express';
import { router as authRoutes } from './auth.routes.js';
import { router as rentalRoutes } from './rental.routes.js';

export const router = Router();

router.use('/auth', authRoutes);
router.use('/rentals', rentalRoutes);
router.use('/equipment', equipmentRoutes);
```

### Route Rules

1. **Named export**: `export const router = Router()`
2. **Named imports** for controllers and middleware
3. **RESTful**: POST create, GET read, PUT update, DELETE delete
4. **Middleware inline**: `router.get(path, auth, ownerCheck, handler)`
5. **Mount in index.js** with descriptive aliases: `import { router as rentalRoutes }`
6. **Prefixed in app.js**: `app.use('/api/v1', routes)`

---

## 10. Error Handling Architecture

### Error Class Hierarchy

```
Error (native)
└── AppError (base, takes statusCode + message)
    ├── BadRequestError    (400)
    ├── UnauthorizedError  (401)
    ├── ForbiddenError     (403) — if needed
    ├── NotFoundError      (404)
    └── ConflictError      (409)
```

### Centralized Error Handler

```javascript
import { AppError } from '../utils/AppError.js';

export const errorHandler = (err, req, res, next) => {
  // 1. Custom app errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  // 2. Mongoose validation
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message).join(', ');
    return res.status(400).json({ error: messages });
  }

  // 3. MongoDB duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    return res.status(400).json({ error: `${field} already exists` });
  }

  // 4. Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    return res.status(400).json({ error: `Invalid ${err.path}: ${err.value}` });
  }

  // 5. Unknown errors
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
```

### Error Flow

```
Service throws → Express 5 catches → errorHandler formats → JSON response
```

**No try/catch in controllers or middleware (except JWT verify and transactions).**

---

## 11. Query & Database Patterns

### Dynamic Query Building

```javascript
export const getEquipment = async (filters = {}) => {
  const { category, status, search } = filters;

  const query = { deleted_at: null };
  if (category) query.category_id = category;
  if (status) query.status = status;
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
    ];
  }

  return Equipment.find(query).populate('category_id', 'name').sort({ created_at: -1 });
};
```

### Comma-Separated Multi-Value Filters

```javascript
if (status) {
  const statuses = status.split(',');
  query.status = statuses.length > 1 ? { $in: statuses } : status;
}
```

### Pagination

```javascript
const pageNum = Math.max(1, parseInt(page, 10));
const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
const skip = (pageNum - 1) * limitNum;

const [items, total] = await Promise.all([
  Model.find(query).sort(sort).skip(skip).limit(limitNum).lean(),
  Model.countDocuments(query),
]);

return {
  items,
  pagination: {
    page: pageNum,
    limit: limitNum,
    total,
    totalPages: Math.ceil(total / limitNum),
    hasNextPage: pageNum < Math.ceil(total / limitNum),
    hasPrevPage: pageNum > 1,
  },
};
```

### Population

```javascript
// Simple: field + select
.populate('user_id', 'name email')

// Complex: nested population
.populate({
  path: 'equipment_id',
  select: 'name daily_rate weekly_rate',
  populate: { path: 'category_id', select: 'name' },
})

// Shared populate configs (for reuse)
export const RENTAL_POPULATE = [
  { path: 'user_id', select: 'name email' },
  { path: 'equipment_id', select: 'name daily_rate weekly_rate' },
];
```

### Aggregation Pipelines

```javascript
const stats = await Model.aggregate([
  { $match: { status: { $in: ['active', 'completed'] } } },
  { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } },
  { $sort: { count: -1 } },
]);
```

### MongoDB Transactions (for atomic operations)

```javascript
const session = await mongoose.startSession();
session.startTransaction();

try {
  const doc = await Model.create([{ ...data }], { session });
  await OtherModel.updateOne({ ... }, { ... }).session(session);
  await session.commitTransaction();
  return doc;
} catch (error) {
  await session.abortTransaction();
  throw error;
} finally {
  session.endSession();
}
```

---

## 12. Utility Patterns

### Constants

```javascript
// Export constants near where they're used or in helpers
export const DAY_MS = 86_400_000;
export const MAX_DEPTH = 5;
```

### Helper Functions

```javascript
// Pure functions — no side effects
export function calculateCost(days, dailyRate, weeklyRate) {
  if (days < 1) return 0;
  if (days >= 7) {
    const weeks = Math.floor(days / 7);
    const remaining = days % 7;
    return weeks * weeklyRate + remaining * dailyRate;
  }
  return days * dailyRate;
}
```

### Recursive Sanitization

```javascript
export function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitize);

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = value.replace(/[<>]/g, '');
    } else if (typeof value === 'object') {
      result[key] = sanitize(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
```

---

## 13. Test Case Standards

### Framework & Dependencies

| Tool | Purpose |
|------|---------|
| **Mocha** | Test runner |
| **Chai** | Assertions (`expect` style) |
| **chai-http** | HTTP/API testing |
| **cross-env** | Cross-platform env vars |
| **mocha-multi-reporters** | Console + XML output |

### File Organization

```
test/
├── task1/app.spec.js    # Feature group 1
├── task2/app.spec.js    # Feature group 2
├── task3/app.spec.js    # Feature group 3
└── ...
```

Each task is a standalone test file that tests a specific feature/bug area.

### Test Script Pattern

```json
{
  "test:task1": "cross-env NODE_ENV=test PORT=8081 MOCHA_FILE=../output/task1.xml mocha --reporter mocha-multi-reporters --reporter-options configFile=mocha-reporters.json test/task1/*.js --exit"
}
```

### Test Structure Template

```javascript
import chai from 'chai';
import chaiHttp from 'chai-http';
import mongoose from 'mongoose';
import { app } from '../../src/app.js';
import { connectDB } from '../../src/config/db.js';
import { User } from '../../src/models/User.js';
import { generateToken } from '../../src/utils/auth.js';

const { expect } = chai;
chai.use(chaiHttp);

describe('Feature Name Testing', function () {
  this.timeout(10000);

  // Shared state
  let user, token, testData;

  // Reusable cleanup
  const cleanupModels = async (models = [User, Equipment, Rental]) => {
    await Promise.all(models.map((Model) => Model.deleteMany({})));
  };

  before(async () => {
    // 1. Set test env
    process.env.NODE_ENV = 'test';

    // 2. Connect to DB
    await connectDB();

    // 3. Verify test database (SAFETY CHECK)
    const dbName = mongoose.connection.db?.databaseName || mongoose.connection.name;
    if (dbName && !dbName.includes('test')) {
      throw new Error(`Not connected to test database! Connected to: ${dbName}`);
    }

    // 4. Clean slate
    await cleanupModels();

    // 5. Create test fixtures
    const bcrypt = await import('bcrypt');
    const hashedPassword = await bcrypt.default.hash('password123', 12);

    user = new User({
      email: 'test@test.com',
      password: hashedPassword,
      name: 'Test User',
    });
    await user.save();
    token = generateToken(user._id);
  });

  beforeEach(async () => {
    // Reset per-test state if needed
    await Rental.deleteMany({});
  });

  afterEach(async () => {
    // Cleanup test-specific data
    await cleanupModels([Rental]);
  });

  after(async () => {
    // Full cleanup & disconnect
    await cleanupModels();
    await mongoose.connection.close();
  });

  // ---- Tests ----

  it('should create a rental successfully', async () => {
    const res = await chai
      .request(app)
      .post('/api/v1/rentals')
      .set('Authorization', `Bearer ${token}`)
      .send({
        equipment_id: equipment._id.toString(),
        start_date: '2025-03-01',
        delivery_date: '2025-03-02',
        end_date: '2025-03-10',
      });

    expect(res).to.have.status(201);
    expect(res.body).to.have.property('rental');
    expect(res.body.rental).to.have.property('status', 'pending');
  });

  it('should return 404 for non-existent rental', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const res = await chai
      .request(app)
      .get(`/api/v1/rentals/${fakeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res).to.have.status(404);
    expect(res.body).to.have.property('error');
  });

  it('should return 401 without authentication', async () => {
    const res = await chai
      .request(app)
      .get('/api/v1/rentals');

    expect(res).to.have.status(401);
  });
});
```

### Test Naming Convention

- **Describe blocks**: Feature name + "Testing" — `'Rental CRUD Testing'`
- **It blocks**: BDD "should" prefix — `'should create a rental successfully'`
- **Error tests**: Include expected status — `'should return 404 for non-existent rental'`

### HTTP Testing Patterns

```javascript
// GET with query params
const res = await chai
  .request(app)
  .get('/api/v1/equipment?category=excavators&status=available')
  .set('Authorization', `Bearer ${token}`);

// POST with body
const res = await chai
  .request(app)
  .post('/api/v1/rentals')
  .set('Authorization', `Bearer ${token}`)
  .send({ equipment_id: id, start_date: '2025-03-01' });

// PUT with params + body
const res = await chai
  .request(app)
  .put(`/api/v1/rentals/${rentalId}`)
  .set('Authorization', `Bearer ${token}`)
  .send({ status: 'active' });

// DELETE
const res = await chai
  .request(app)
  .delete(`/api/v1/rentals/${rentalId}`)
  .set('Authorization', `Bearer ${token}`);

// No auth (test 401)
const res = await chai.request(app).get('/api/v1/rentals');
```

### Assertion Patterns

```javascript
// Status
expect(res).to.have.status(200);
expect(res).to.have.status(201);
expect(res).to.have.status(400);
expect(res).to.have.status(401);
expect(res).to.have.status(404);

// Property existence & value
expect(res.body).to.have.property('rental');
expect(res.body).to.have.property('error', 'Equipment not found');
expect(res.body.rental).to.have.property('status', 'pending');

// Arrays
expect(res.body.rentals).to.be.an('array').with.length(3);
expect(res.body.rentals).to.be.an('array').with.lengthOf(0);

// Boolean
expect(res.body.rental.isOverdue).to.be.true;

// Null
expect(res.body.rental.coupon_id).to.be.null;

// Existence
expect(createdDoc).to.exist;
expect(deletedDoc).to.be.null;

// Numeric
expect(res.body.pagination.total).to.be.at.least(1);
expect(res.body.rental.total_cost).to.equal(500);

// String content
expect(res.body.error.toLowerCase()).to.include('not found');

// Database verification (after API call)
const dbDoc = await Model.findById(id);
expect(dbDoc).to.exist;
expect(dbDoc.status).to.equal('completed');
```

### Edge Case Coverage Checklist

Every feature test file should cover:

- [ ] Happy path (successful CRUD operations)
- [ ] Validation errors (missing/invalid fields → 400)
- [ ] Not found errors (invalid IDs → 404)
- [ ] Authentication required (no token → 401)
- [ ] Authorization (wrong user → 403)
- [ ] Duplicate/conflict errors (→ 409 or 400)
- [ ] Empty result sets (valid query, no matches → 200 with empty array)
- [ ] Idempotency (same operation twice → same result)
- [ ] State transitions (valid and invalid)
- [ ] Cascade operations (delete with related records)

### Test Data Management Rules

1. **Real database**: Tests use actual MongoDB (test database), no mocking
2. **Safety check**: Always verify connected to test DB before running
3. **Cleanup helper**: Reusable `cleanupModels()` function
4. **before()**: Connect + create shared fixtures (users, tokens)
5. **beforeEach()**: Reset per-test data
6. **afterEach()**: Clean test-specific data
7. **after()**: Full cleanup + close connection
8. **Direct model creation**: Use `new Model({}).save()` or `Model.insertMany()`
9. **Password hashing**: Use bcrypt with salt 12 for test users

---

## 14. Response Format Standards

### Success Responses

```javascript
// Single item
res.json({ rental });               // 200
res.status(201).json({ rental });    // 201 Created

// Collection
res.json({ rentals });               // 200
res.json({ equipment });             // 200

// With message
res.json({ message: 'Rental cancelled successfully' });
res.status(201).json({ message: 'User registered successfully', token, user });

// With pagination
res.json({
  equipment,
  pagination: { page, limit, total, totalPages, hasNextPage, hasPrevPage },
});
```

### Error Responses

```javascript
// All errors use same shape
{ "error": "Equipment not found" }           // 404
{ "error": "end_date must be after delivery_date" }  // 400
{ "error": "Authentication required" }       // 401
{ "error": "email already exists" }          // 400 (duplicate key)
```

**Key**: Success uses descriptive keys (`rental`, `rentals`). Errors always use `"error"` key.

---

## 15. Quick Reference Cheat Sheet

```
CONTROLLER:  export const fn = async (req, res) => { ... }
             NO try/catch. Extract → call service → respond.

SERVICE:     export const fn = async (args) => { ... }
             ALL business logic. throw new XxxError('message').

MODEL:       export const Model = mongoose.model('Name', schema)
             Schema + indexes + plugins + static/instance methods.

MIDDLEWARE:  export const fn = async (req, res, next) => { ... }
             throw errors, never res.status().json().

ROUTE:       export const router = Router()
             router.verb(path, ...middleware, controller)

ERROR:       throw new BadRequestError('message')    → 400
             throw new UnauthorizedError('message')  → 401
             throw new NotFoundError('message')      → 404
             throw new ConflictError('message')      → 409

IMPORT:      { Model } from models
             * as service from services
             { middleware } from middleware
             { config } from config
             { router as alias } from routes

TEST:        describe('Feature Testing', function() { ... })
             it('should do something', async () => { ... })
             expect(res).to.have.status(200)
             expect(res.body).to.have.property('key')
```
