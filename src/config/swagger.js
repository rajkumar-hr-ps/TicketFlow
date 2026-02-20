import swaggerJsdoc from 'swagger-jsdoc';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'TicketFlow API',
    version: '1.0.0',
    description:
      'Event Ticketing Platform API — manage events, venues, orders, tickets, and more.',
  },
  servers: [
    {
      url: '/api/v1',
      description: 'API v1',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string' },
        },
      },
      User: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          name: { type: 'string', maxLength: 100 },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['customer', 'organizer', 'admin'] },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Venue: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          name: { type: 'string', maxLength: 200 },
          address: { type: 'string', maxLength: 500 },
          city: { type: 'string', maxLength: 100 },
          total_capacity: { type: 'integer', minimum: 1 },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Event: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          title: { type: 'string', maxLength: 300 },
          description: { type: 'string', maxLength: 2000 },
          venue_id: { type: 'string' },
          organizer_id: { type: 'string' },
          start_date: { type: 'string', format: 'date-time' },
          end_date: { type: 'string', format: 'date-time' },
          status: {
            type: 'string',
            enum: ['draft', 'published', 'on_sale', 'sold_out', 'completed', 'cancelled'],
          },
          category: {
            type: 'string',
            enum: ['concert', 'sports', 'theater', 'conference', 'festival', 'comedy'],
          },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Section: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          event_id: { type: 'string' },
          venue_id: { type: 'string' },
          name: { type: 'string', maxLength: 100 },
          capacity: { type: 'integer', minimum: 1 },
          base_price: { type: 'number', minimum: 0 },
          sold_count: { type: 'integer' },
          held_count: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Ticket: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          order_id: { type: 'string' },
          event_id: { type: 'string' },
          section_id: { type: 'string' },
          user_id: { type: 'string' },
          original_user_id: { type: 'string' },
          status: {
            type: 'string',
            enum: ['held', 'confirmed', 'used', 'cancelled', 'refunded', 'transferred'],
          },
          unit_price: { type: 'number' },
          service_fee: { type: 'number' },
          facility_fee: { type: 'number' },
          hold_expires_at: { type: 'string', format: 'date-time', nullable: true },
          transferred_at: { type: 'string', format: 'date-time', nullable: true },
          scan_count: { type: 'integer' },
          last_scanned_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Order: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          user_id: { type: 'string' },
          event_id: { type: 'string' },
          tickets: {
            type: 'array',
            items: { type: 'string' },
          },
          quantity: { type: 'integer', minimum: 1 },
          subtotal: { type: 'number' },
          service_fee_total: { type: 'number' },
          facility_fee_total: { type: 'number' },
          processing_fee: { type: 'number' },
          discount_amount: { type: 'number' },
          total_amount: { type: 'number' },
          promo_code_id: { type: 'string', nullable: true },
          status: {
            type: 'string',
            enum: ['pending', 'confirmed', 'cancelled', 'refunded'],
          },
          payment_status: {
            type: 'string',
            enum: ['pending', 'processing', 'paid', 'failed', 'refunded'],
          },
          idempotency_key: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      PromoCode: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          code: { type: 'string' },
          event_id: { type: 'string', nullable: true },
          discount_type: { type: 'string', enum: ['percentage', 'fixed'] },
          discount_value: { type: 'number', minimum: 0 },
          max_uses: { type: 'integer', minimum: 1 },
          current_uses: { type: 'integer' },
          valid_from: { type: 'string', format: 'date-time' },
          valid_to: { type: 'string', format: 'date-time' },
          min_tickets: { type: 'integer' },
          max_discount_amount: { type: 'number', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      Payment: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          order_id: { type: 'string' },
          user_id: { type: 'string' },
          amount: { type: 'number' },
          type: { type: 'string', enum: ['purchase', 'refund'] },
          status: {
            type: 'string',
            enum: ['pending', 'processing', 'completed', 'failed'],
          },
          payment_method: {
            type: 'string',
            enum: ['credit_card', 'debit_card', 'wallet'],
            nullable: true,
          },
          idempotency_key: { type: 'string' },
          processed_at: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      WaitlistEntry: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          event_id: { type: 'string' },
          user_id: { type: 'string' },
          position: { type: 'integer' },
          status: {
            type: 'string',
            enum: ['waiting', 'notified', 'expired', 'converted'],
          },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    // ==================== Auth ====================
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        description:
          'Creates a new user account and returns a JWT token. The token must be included as a Bearer token in the Authorization header for all protected endpoints.\n\n' +
          '**Roles:** Defaults to **customer**. Use **organizer** to create/manage events, or **admin** for full access.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', example: 'John Doe' },
                  email: { type: 'string', format: 'email', example: 'john@example.com' },
                  password: { type: 'string', minLength: 6, example: 'secret123' },
                  role: {
                    type: 'string',
                    enum: ['customer', 'organizer', 'admin'],
                    default: 'customer',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'User registered successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login and obtain a JWT token',
        description:
          'Authenticates with email and password. Returns a JWT token to use in the Authorization header as: **Bearer &lt;token&gt;**',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'john@example.com' },
                  password: { type: 'string', example: 'secret123' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          401: {
            description: 'Invalid credentials',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get current user profile',
        description: 'Returns the profile of the currently authenticated user. Requires a valid JWT token.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'Current user profile',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // ==================== Venues ====================
    '/venues': {
      post: {
        tags: ['Venues'],
        summary: 'Create a new venue',
        description:
          'Creates a new venue. The venue ID is needed when creating events. Requires authentication.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'address', 'city', 'total_capacity'],
                properties: {
                  name: { type: 'string', example: 'Madison Square Garden' },
                  address: { type: 'string', example: '4 Pennsylvania Plaza' },
                  city: { type: 'string', example: 'New York' },
                  total_capacity: { type: 'integer', minimum: 1, example: 20000 },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Venue created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    venue: { $ref: '#/components/schemas/Venue' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
      get: {
        tags: ['Venues'],
        summary: 'List all venues',
        description: 'Returns all venues. Use the venue _id from the response when creating events.',
        responses: {
          200: {
            description: 'List of venues',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    venues: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Venue' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/venues/{id}': {
      get: {
        tags: ['Venues'],
        summary: 'Get venue by ID',
        description: 'Returns a single venue by its ID.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Venue ID',
          },
        ],
        responses: {
          200: {
            description: 'Venue details',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    venue: { $ref: '#/components/schemas/Venue' },
                  },
                },
              },
            },
          },
          404: {
            description: 'Venue not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // ==================== Events ====================
    '/events': {
      post: {
        tags: ['Events'],
        summary: 'Create a new event with optional sections',
        description:
          'Creates an event in `draft` status. Optionally pass a `sections` array to create ticket sections at the same time.\n\n' +
          '**Status flow:** `draft` → `published` → `on_sale` (use `PATCH /events/{id}/status` to transition).\n\n' +
          '**Note:** `venue_id` must be a valid venue ID from `GET /venues`. The `end_date` must be after `start_date`.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'venue_id', 'start_date', 'end_date', 'category'],
                properties: {
                  title: { type: 'string', description: 'Event title (max 300 chars).', example: 'Rock Concert 2026' },
                  description: { type: 'string', description: 'Optional. Event description (max 2000 chars).', example: 'An amazing rock concert' },
                  venue_id: { type: 'string', description: 'ID of an existing venue. Get from GET /venues.', example: '6997ef07c1b70dc3d9e293e9' },
                  start_date: { type: 'string', format: 'date-time', description: 'Event start time in ISO 8601 format.', example: '2026-03-15T18:00:00.000Z' },
                  end_date: { type: 'string', format: 'date-time', description: 'Event end time. Must be after start_date.', example: '2026-03-15T22:00:00.000Z' },
                  category: {
                    type: 'string',
                    enum: ['concert', 'sports', 'theater', 'conference', 'festival', 'comedy'],
                    description: 'Event category.',
                    example: 'concert',
                  },
                  sections: {
                    type: 'array',
                    description: 'Optional. Define ticket sections at creation time. Can also add sections later.',
                    items: {
                      type: 'object',
                      required: ['name', 'capacity', 'base_price'],
                      properties: {
                        name: { type: 'string', description: 'Section name (e.g. VIP, General, Balcony).', example: 'VIP' },
                        capacity: { type: 'integer', minimum: 1, description: 'Maximum tickets available in this section.', example: 100 },
                        base_price: { type: 'number', minimum: 0, description: 'Base ticket price before dynamic pricing fees.', example: 150.00 },
                      },
                    },
                  },
                },
              },
              examples: {
                'Event with Sections': {
                  summary: 'Create event with VIP and General sections',
                  value: {
                    title: 'Rock Concert 2026',
                    description: 'An amazing rock concert',
                    venue_id: '6997ef07c1b70dc3d9e293e9',
                    start_date: '2026-03-15T18:00:00.000Z',
                    end_date: '2026-03-15T22:00:00.000Z',
                    category: 'concert',
                    sections: [
                      { name: 'VIP', capacity: 100, base_price: 150 },
                      { name: 'General', capacity: 500, base_price: 50 },
                    ],
                  },
                },
                'Event without Sections': {
                  summary: 'Create event only (add sections later)',
                  value: {
                    title: 'Comedy Night',
                    venue_id: '6997ef07c1b70dc3d9e293e9',
                    start_date: '2026-04-01T20:00:00.000Z',
                    end_date: '2026-04-01T23:00:00.000Z',
                    category: 'comedy',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Event created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    event: { $ref: '#/components/schemas/Event' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          409: {
            description: 'Venue scheduling conflict',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
      get: {
        tags: ['Events'],
        summary: 'List events with optional filters and pagination',
        description:
          'Returns a paginated list of events. All query parameters are optional. You can filter by status, category, or venue_id. Supports pagination via page and limit.',
        parameters: [
          {
            name: 'status',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by status (comma-separated for multiple)',
          },
          {
            name: 'category',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['concert', 'sports', 'theater', 'conference', 'festival', 'comedy'],
            },
          },
          {
            name: 'venue_id',
            in: 'query',
            schema: { type: 'string' },
          },
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1 },
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 20, maximum: 100 },
          },
        ],
        responses: {
          200: {
            description: 'Paginated list of events',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    events: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Event' },
                    },
                    pagination: {
                      type: 'object',
                      properties: {
                        page: { type: 'integer' },
                        limit: { type: 'integer' },
                        total: { type: 'integer' },
                        totalPages: { type: 'integer' },
                        hasNextPage: { type: 'boolean' },
                        hasPrevPage: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/events/{id}': {
      get: {
        tags: ['Events'],
        summary: 'Get event by ID with sections and availability',
        description:
          'Returns event details along with its sections and available ticket counts. Use the section _id and event _id from this response when creating orders.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Event ID',
          },
        ],
        responses: {
          200: {
            description: 'Event details with sections',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    event: { $ref: '#/components/schemas/Event' },
                    sections: {
                      type: 'array',
                      items: {
                        allOf: [
                          { $ref: '#/components/schemas/Section' },
                          {
                            type: 'object',
                            properties: {
                              available: { type: 'integer' },
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
          404: {
            description: 'Event not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
    '/events/{id}/status': {
      patch: {
        tags: ['Events'],
        summary: 'Update event status (state machine transitions)',
        description:
          'Transitions an event to a new status. Only valid transitions are allowed:\n\n' +
          '| Current Status | Allowed Transitions |\n' +
          '|---|---|\n' +
          '| `draft` | `published` |\n' +
          '| `published` | `on_sale`, `cancelled` |\n' +
          '| `on_sale` | `sold_out`, `completed`, `cancelled` |\n' +
          '| `sold_out` | `on_sale`, `completed`, `cancelled` |\n' +
          '| `completed` | _(none)_ |\n' +
          '| `cancelled` | _(none)_ |\n\n' +
          '**Cancelling** an event with confirmed orders will automatically refund all orders and cancel held tickets.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Event ID',
            example: '6997f24063f79b24d3cc9dab',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: {
                    type: 'string',
                    enum: ['published', 'on_sale', 'sold_out', 'completed', 'cancelled'],
                    description: 'The target status. Must be a valid transition from the current status.',
                  },
                },
              },
              examples: {
                'Publish a draft': {
                  summary: 'draft → published',
                  value: { status: 'published' },
                },
                'Open ticket sales': {
                  summary: 'published → on_sale',
                  value: { status: 'on_sale' },
                },
                'Cancel event': {
                  summary: 'Cancel and refund all orders',
                  value: { status: 'cancelled' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Event status updated. For cancellation, includes refund cascade results.',
            content: {
              'application/json': {
                schema: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        event: { $ref: '#/components/schemas/Event' },
                      },
                    },
                    {
                      type: 'object',
                      properties: {
                        event_id: { type: 'string' },
                        status: { type: 'string' },
                        orders_processed: { type: 'integer' },
                        refunds: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              order_id: { type: 'string' },
                              refund_amount: { type: 'number' },
                              tickets_cancelled: { type: 'integer' },
                              status: { type: 'string' },
                            },
                          },
                        },
                        held_tickets_cancelled: { type: 'integer' },
                      },
                    },
                  ],
                },
              },
            },
          },
          400: {
            description: 'Invalid status transition',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          404: {
            description: 'Event not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // ==================== Sections ====================
    '/events/{id}/sections': {
      get: {
        tags: ['Sections'],
        summary: 'Get sections for an event',
        description: 'Returns all ticket sections for an event, including capacity, sold_count, held_count, and base_price.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Event ID',
          },
        ],
        responses: {
          200: {
            description: 'List of sections',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sections: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Section' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/events/{eventId}/sections/{sectionId}/availability': {
      get: {
        tags: ['Sections'],
        summary: 'Get section availability',
        description: 'Returns real-time availability for a specific section: capacity, sold_count, held_count, and available seats.',
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Event ID',
          },
          {
            name: 'sectionId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Section ID',
          },
        ],
        responses: {
          200: {
            description: 'Section availability info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    section_id: { type: 'string' },
                    available: { type: 'integer' },
                    capacity: { type: 'integer' },
                    sold_count: { type: 'integer' },
                    held_count: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ==================== Orders ====================
    '/orders': {
      post: {
        tags: ['Orders'],
        summary: 'Create a new order (single or multi-section)',
        description:
          'Creates an order and a pending payment record. Supports two modes:\n\n' +
          '**Single-section:** Pass `event_id`, `section_id`, and `quantity`.\n\n' +
          '**Multi-section:** Pass `event_id` and a `sections` array (do NOT pass `section_id`/`quantity`).\n\n' +
          'The event must be in `on_sale` status.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['event_id'],
                properties: {
                  event_id: {
                    type: 'string',
                    description: 'The ID of the event to order tickets for. Event must be in on_sale status.',
                    example: '6997f24063f79b24d3cc9dab',
                  },
                  section_id: {
                    type: 'string',
                    description: 'Required for single-section orders. Omit when using the sections array.',
                    example: '6997f24063f79b24d3cc9dad',
                  },
                  quantity: {
                    type: 'integer',
                    minimum: 1,
                    description: 'Required for single-section orders. Number of tickets to purchase.',
                    example: 2,
                  },
                  promo_code: {
                    type: 'string',
                    description: 'Optional. A valid promotional code for a discount.',
                    example: 'SAVE20',
                  },
                  idempotency_key: {
                    type: 'string',
                    description: 'Optional. Unique key to prevent duplicate orders on retry.',
                    example: 'order-user123-evt456-1',
                  },
                  sections: {
                    type: 'array',
                    description:
                      'For multi-section orders. Use this instead of section_id + quantity to order tickets from multiple sections at once.',
                    items: {
                      type: 'object',
                      required: ['section_id', 'quantity'],
                      properties: {
                        section_id: {
                          type: 'string',
                          description: 'Section ID to order from.',
                          example: '6997f24063f79b24d3cc9dad',
                        },
                        quantity: {
                          type: 'integer',
                          minimum: 1,
                          description: 'Number of tickets for this section.',
                          example: 2,
                        },
                      },
                    },
                  },
                },
              },
              examples: {
                'Single Section': {
                  summary: 'Order from one section',
                  value: {
                    event_id: '6997f24063f79b24d3cc9dab',
                    section_id: '6997f24063f79b24d3cc9dad',
                    quantity: 2,
                  },
                },
                'Single Section with Promo': {
                  summary: 'Order with a promo code applied',
                  value: {
                    event_id: '6997f24063f79b24d3cc9dab',
                    section_id: '6997f24063f79b24d3cc9dad',
                    quantity: 2,
                    promo_code: 'SAVE20',
                  },
                },
                'Multi Section': {
                  summary: 'Order from multiple sections at once',
                  value: {
                    event_id: '6997f24063f79b24d3cc9dab',
                    sections: [
                      { section_id: '6997f24063f79b24d3cc9dad', quantity: 2 },
                      { section_id: '6997f24063f79b24d3cc9dae', quantity: 1 },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Order created with pricing breakdown',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    order: { $ref: '#/components/schemas/Order' },
                    unit_price: { type: 'number' },
                    multiplier: { type: 'number' },
                    subtotal: { type: 'number' },
                    service_fee_total: { type: 'number' },
                    facility_fee_total: { type: 'number' },
                    processing_fee: { type: 'number' },
                    discount_amount: { type: 'number' },
                    total_amount: { type: 'number' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation error or insufficient capacity',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          404: {
            description: 'Event or section not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
      get: {
        tags: ['Orders'],
        summary: 'Get current user orders',
        description: 'Returns all orders for the currently authenticated user, sorted by most recent.',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'List of user orders',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    orders: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Order' },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
    '/orders/{id}': {
      get: {
        tags: ['Orders'],
        summary: 'Get order by ID',
        description: 'Returns full order details including populated ticket information. Use the order _id from this response to fetch payments or request a refund.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Order ID',
          },
        ],
        responses: {
          200: {
            description: 'Order details with populated tickets',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    order: { $ref: '#/components/schemas/Order' },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          404: {
            description: 'Order not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // ==================== Promo Codes ====================
    '/promo-codes': {
      post: {
        tags: ['Promo Codes'],
        summary: 'Create a promo code',
        description:
          'Creates a promotional discount code. Codes can be scoped to a specific event or apply platform-wide.\n\n' +
          '**Discount types:**\n' +
          '- `percentage` — discount_value is a % (1–100). Optionally cap with `max_discount_amount`.\n' +
          '- `fixed` — discount_value is a flat dollar amount deducted from the total.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code', 'discount_type', 'discount_value', 'max_uses', 'valid_from', 'valid_to'],
                properties: {
                  code: { type: 'string', description: 'Unique promo code string. Case-sensitive.', example: 'SUMMER20' },
                  event_id: { type: 'string', nullable: true, description: 'Optional. Scope to a specific event. Omit or null for a platform-wide code.', example: '6997f24063f79b24d3cc9dab' },
                  discount_type: { type: 'string', enum: ['percentage', 'fixed'], description: '"percentage" for % off, "fixed" for flat dollar amount off.', example: 'percentage' },
                  discount_value: { type: 'number', minimum: 0, description: 'For percentage: 1–100. For fixed: dollar amount (e.g. 10 = $10 off).', example: 20 },
                  max_uses: { type: 'integer', minimum: 1, description: 'Maximum number of times this code can be redeemed.', example: 100 },
                  valid_from: { type: 'string', format: 'date-time', description: 'Code is valid starting from this date.', example: '2026-02-01T00:00:00.000Z' },
                  valid_to: { type: 'string', format: 'date-time', description: 'Code expires after this date.', example: '2026-12-31T23:59:59.000Z' },
                  min_tickets: { type: 'integer', default: 1, description: 'Optional. Minimum tickets in the order for the code to apply.', example: 2 },
                  max_discount_amount: { type: 'number', nullable: true, description: 'Optional. Cap on the discount for percentage codes (e.g. "20% off, max $50"). Ignored for fixed type.', example: 50 },
                },
              },
              examples: {
                'Percentage (platform-wide)': {
                  summary: '20% off, max $50, any event',
                  value: {
                    code: 'SAVE20',
                    discount_type: 'percentage',
                    discount_value: 20,
                    max_uses: 100,
                    valid_from: '2026-02-01T00:00:00.000Z',
                    valid_to: '2026-12-31T23:59:59.000Z',
                    max_discount_amount: 50,
                  },
                },
                'Fixed (event-specific)': {
                  summary: '$10 off for a specific event, min 2 tickets',
                  value: {
                    code: 'CONCERT10',
                    event_id: '6997f24063f79b24d3cc9dab',
                    discount_type: 'fixed',
                    discount_value: 10,
                    max_uses: 50,
                    valid_from: '2026-02-01T00:00:00.000Z',
                    valid_to: '2026-03-15T00:00:00.000Z',
                    min_tickets: 2,
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Promo code created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    promo: { $ref: '#/components/schemas/PromoCode' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
    '/promo-codes/{code}/validate': {
      get: {
        tags: ['Promo Codes'],
        summary: 'Validate a promo code',
        description:
          'Checks if a promo code is valid. Validates expiry dates, max usage, event scope, and minimum ticket requirements. Pass event_id and quantity to check all conditions.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'code',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Promo code string',
          },
          {
            name: 'event_id',
            in: 'query',
            schema: { type: 'string' },
            description: 'Event ID to validate against',
          },
          {
            name: 'quantity',
            in: 'query',
            schema: { type: 'integer', default: 1 },
            description: 'Ticket quantity for min_tickets validation',
          },
        ],
        responses: {
          200: {
            description: 'Promo code validation result',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    valid: { type: 'boolean' },
                    promo: { $ref: '#/components/schemas/PromoCode' },
                    discount_type: { type: 'string' },
                    discount_value: { type: 'number' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid promo code',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // ==================== Payments ====================
    '/payments/orders/{id}/payments': {
      get: {
        tags: ['Payments'],
        summary: 'Get payments for an order',
        description:
          'Returns all payment records for an order. A payment is auto-created when an order is placed. Use the payment _id and amount from this response when calling the webhook endpoint.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Order ID',
          },
        ],
        responses: {
          200: {
            description: 'List of payments',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    payments: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/Payment' },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
    '/webhook': {
      post: {
        tags: ['Payments'],
        summary: 'Payment webhook endpoint',
        description:
          'Simulates a payment provider webhook callback. Use this to mark a pending payment as completed or failed.\n\n' +
          '**How to get the required values:**\n\n' +
          '**Step 1:** Create an order via POST /orders — this auto-creates a pending payment.\n\n' +
          '**Step 2:** Fetch payments via GET /orders/{id}/payments to get the payment_id and amount.\n\n' +
          '**Step 3:** Call this endpoint with those values to complete or fail the payment.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['webhook_event_id', 'payment_id', 'status', 'amount'],
                properties: {
                  webhook_event_id: {
                    type: 'string',
                    description: 'A unique ID for this webhook event. Used for idempotency — sending the same ID twice will be ignored as a duplicate.',
                    example: 'evt_001',
                  },
                  payment_id: {
                    type: 'string',
                    description: 'The payment ID to update. Retrieve from GET /orders/{id}/payments.',
                    example: '6997f30063f79b24d3cc9db0',
                  },
                  status: {
                    type: 'string',
                    enum: ['completed', 'failed'],
                    description: 'The payment result. "completed" confirms the order and issues tickets. "failed" marks the payment as failed.',
                    example: 'completed',
                  },
                  amount: {
                    type: 'number',
                    description: 'Must match the order total_amount exactly. A mismatch will be rejected.',
                    example: 150.00,
                  },
                  payment_method: {
                    type: 'string',
                    enum: ['credit_card', 'debit_card', 'wallet'],
                    description: 'Optional. The payment method used.',
                    example: 'credit_card',
                  },
                },
              },
              examples: {
                'Successful Payment': {
                  summary: 'Mark payment as completed',
                  value: {
                    webhook_event_id: 'evt_001',
                    payment_id: '6997f30063f79b24d3cc9db0',
                    status: 'completed',
                    amount: 150.00,
                  },
                },
                'Failed Payment': {
                  summary: 'Mark payment as failed',
                  value: {
                    webhook_event_id: 'evt_002',
                    payment_id: '6997f30063f79b24d3cc9db0',
                    status: 'failed',
                    amount: 150.00,
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Webhook processed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    received: { type: 'boolean' },
                    order_id: { type: 'string' },
                    order_status: { type: 'string' },
                    payment_status: { type: 'string' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Invalid signature or payload',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // ==================== Features (src/features/) ====================

    // -------- Seat Map (features/seat_availability_map) --------
    '/events/{id}/sections/{sectionId}/seat-map': {
      get: {
        tags: ['Seat Map'],
        summary: 'Get seat availability map for a section',
        description:
          'Returns a detailed seat map for a section including capacity, sold/held/available counts, sell-through percentage, dynamic pricing (base_price, multiplier, current_price, fees), and overall status (available or sold_out).',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Event ID',
          },
          {
            name: 'sectionId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Section ID',
          },
        ],
        responses: {
          200: {
            description: 'Seat map with availability and pricing',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    event_id: { type: 'string' },
                    event_title: { type: 'string' },
                    section_id: { type: 'string' },
                    section_name: { type: 'string' },
                    capacity: { type: 'integer' },
                    sold: { type: 'integer' },
                    held: { type: 'integer' },
                    available: { type: 'integer' },
                    sell_through_pct: { type: 'number' },
                    pricing: {
                      type: 'object',
                      properties: {
                        base_price: { type: 'number' },
                        multiplier: { type: 'number' },
                        tier: { type: 'string' },
                        current_price: { type: 'number' },
                        service_fee: { type: 'number' },
                        facility_fee: { type: 'number' },
                      },
                    },
                    status: { type: 'string', enum: ['available', 'sold_out'] },
                  },
                },
              },
            },
          },
          404: {
            description: 'Section or event not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // -------- Schedule (features/event_schedule) --------
    '/events/schedule': {
      get: {
        tags: ['Schedule'],
        summary: 'Get event schedule grouped by venue',
        description:
          'Returns all events within a date range, grouped by venue. Each event includes section count, total available tickets, and price range. Useful for displaying a calendar or schedule view.',
        parameters: [
          {
            name: 'start_date',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
            description: 'Schedule period start. ISO 8601 format.',
            example: '2026-02-01T00:00:00.000Z',
          },
          {
            name: 'end_date',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
            description: 'Schedule period end. ISO 8601 format.',
            example: '2026-02-28T23:59:59.000Z',
          },
        ],
        responses: {
          200: {
            description: 'Schedule grouped by venue',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    period_start: { type: 'string', format: 'date-time' },
                    period_end: { type: 'string', format: 'date-time' },
                    total_events: { type: 'integer' },
                    venues: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          venue_id: { type: 'string' },
                          venue_name: { type: 'string' },
                          city: { type: 'string' },
                          events: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                event_id: { type: 'string' },
                                title: { type: 'string' },
                                category: { type: 'string' },
                                start_date: { type: 'string', format: 'date-time' },
                                end_date: { type: 'string', format: 'date-time' },
                                status: { type: 'string' },
                                sections_count: { type: 'integer' },
                                total_available: { type: 'integer' },
                                price_range: {
                                  type: 'object',
                                  properties: {
                                    min: { type: 'number' },
                                    max: { type: 'number' },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'Missing or invalid date parameters',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // -------- Waitlist (features/waitlist_management) --------
    '/events/{id}/waitlist': {
      post: {
        tags: ['Waitlist'],
        summary: 'Join the waitlist for a sold-out event',
        description:
          'Adds the current user to the waitlist for an event. The event must be in **sold_out** status. Returns the user\'s position in the queue. You cannot join a waitlist twice for the same event.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Event ID. The event must be in sold_out status.',
          },
        ],
        responses: {
          201: {
            description: 'Added to waitlist',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    waitlist_id: { type: 'string' },
                    event_id: { type: 'string' },
                    position: { type: 'integer' },
                    ahead: { type: 'integer' },
                    status: { type: 'string' },
                    joined_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Event is not sold out',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          404: {
            description: 'Event not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          409: {
            description: 'Already on waitlist',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
      get: {
        tags: ['Waitlist'],
        summary: 'Get current user waitlist position for an event',
        description: 'Returns the current user\'s waitlist position, number of people ahead, and total waiting count. Returns 404 if the user is not on the waitlist.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Event ID',
          },
        ],
        responses: {
          200: {
            description: 'Waitlist position info',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    waitlist_id: { type: 'string' },
                    event_id: { type: 'string' },
                    position: { type: 'integer' },
                    ahead: { type: 'integer' },
                    total_waiting: { type: 'integer' },
                    status: { type: 'string' },
                    joined_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          404: {
            description: 'Not on waitlist',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // -------- Ticket Transfer (features/ticket_transfer) --------
    '/tickets/{id}/transfer': {
      post: {
        tags: ['Ticket Transfer'],
        summary: 'Transfer a ticket to another user by email',
        description:
          'Transfers a ticket to another registered user. The original ticket is marked as transferred and a new ticket is created for the recipient.\n\n' +
          '**Requirements:**\n\n' +
          '1. Ticket must be in **confirmed** status (not held, cancelled, used, or already transferred).\n\n' +
          '2. The event must not have started yet.\n\n' +
          '3. The recipient must be a registered user (looked up by email).\n\n' +
          '4. You cannot transfer a ticket to yourself.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Ticket ID. Must be a confirmed ticket owned by the current user.',
            example: '6997f30063f79b24d3cc9dc0',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['to_email'],
                properties: {
                  to_email: { type: 'string', format: 'email', description: 'Email of the recipient. Must be a registered user.', example: 'recipient@example.com' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Ticket transferred',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    transfer_id: { type: 'string' },
                    original_ticket_id: { type: 'string' },
                    new_ticket_id: { type: 'string' },
                    from_user: { type: 'string' },
                    to_user: { type: 'string' },
                    to_email: { type: 'string' },
                    transferred_at: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Ticket not transferable or event already started',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          404: {
            description: 'Ticket or recipient not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // -------- Dynamic Pricing (features/dynamic_pricing) --------
    '/events/{id}/pricing': {
      get: {
        tags: ['Dynamic Pricing'],
        summary: 'Get dynamic pricing for an event section',
        description:
          'Calculates the current ticket price based on demand (sell-through percentage). Returns the base price, dynamic multiplier, per-ticket fees (service fee 12%, facility fee 5%), processing fee ($3.00 flat), and totals for the requested quantity.\n\n' +
          '**Pricing tiers by sell-through:**\n\n' +
          '0–49% → 1.0x standard (base price)\n\n' +
          '50–74% → 1.25x high_demand\n\n' +
          '75–89% → 1.5x very_high_demand\n\n' +
          '90%+ → 2.0x peak (surge pricing)',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Event ID',
          },
          {
            name: 'section_id',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'Section ID',
          },
          {
            name: 'quantity',
            in: 'query',
            schema: { type: 'integer', default: 1 },
            description: 'Number of tickets',
          },
        ],
        responses: {
          200: {
            description: 'Dynamic pricing breakdown',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    event_id: { type: 'string' },
                    event_title: { type: 'string' },
                    section_id: { type: 'string' },
                    section_name: { type: 'string' },
                    quantity: { type: 'integer' },
                    pricing: {
                      type: 'object',
                      properties: {
                        base_price: { type: 'number' },
                        multiplier: { type: 'number' },
                        tier: { type: 'string' },
                        unit_price: { type: 'number' },
                        service_fee_per_ticket: { type: 'number' },
                        facility_fee_per_ticket: { type: 'number' },
                      },
                    },
                    totals: {
                      type: 'object',
                      properties: {
                        subtotal: { type: 'number' },
                        service_fee_total: { type: 'number' },
                        facility_fee_total: { type: 'number' },
                        processing_fee: { type: 'number' },
                        total_amount: { type: 'number' },
                      },
                    },
                    availability: {
                      type: 'object',
                      properties: {
                        capacity: { type: 'integer' },
                        sold: { type: 'integer' },
                        held: { type: 'integer' },
                        available: { type: 'integer' },
                        sell_through_pct: { type: 'number' },
                      },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'Missing section_id or insufficient availability',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          404: {
            description: 'Event or section not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },

    // -------- Refund Processing (features/refund_processing) --------
    '/orders/{id}/refund': {
      post: {
        tags: ['Refund Processing'],
        summary: 'Process a refund for an order (tiered by time until event)',
        description:
          'Refunds a confirmed order. The refund percentage depends on how far the event is:\n\n' +
          '| Time Until Event | Refund | Tier |\n' +
          '|---|---|---|\n' +
          '| > 7 days (168h) | 100% | full_refund |\n' +
          '| > 3 days (72h) | 75% | 75_percent |\n' +
          '| > 1 day (24h) | 50% | 50_percent |\n' +
          '| < 24 hours | **Not allowed** | — |\n\n' +
          'Organizer cancellations always receive a 100% refund regardless of timing.\n\n' +
          '**Note:** Service fees and processing fees are non-refundable. Facility fees are refunded at the same tier percentage. ' +
          'The order must be in confirmed status with paid payment status.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Order ID. The order must be confirmed and paid.',
            example: '6997f30063f79b24d3cc9db5',
          },
        ],
        responses: {
          200: {
            description: 'Refund processed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    refund_amount: { type: 'number' },
                    refund_tier: { type: 'string' },
                    refund_percentage: { type: 'number' },
                    base_refund: { type: 'number' },
                    facility_fee_refund: { type: 'number' },
                    service_fee_refund: { type: 'number' },
                    processing_fee_refund: { type: 'number' },
                    tickets_refunded: { type: 'integer' },
                    order_status: { type: 'string' },
                  },
                },
              },
            },
          },
          400: {
            description: 'Order not eligible for refund',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          401: {
            description: 'Unauthorized',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          404: {
            description: 'Order not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },
    },
  },
  tags: [
    // ── Core ──
    { name: 'Auth', description: 'Authentication and user management' },
    { name: 'Venues', description: 'Venue management' },
    { name: 'Events', description: 'Event creation and management' },
    { name: 'Sections', description: 'Event sections and availability' },
    { name: 'Orders', description: 'Order creation and retrieval' },
    { name: 'Promo Codes', description: 'Promotional code management' },
    { name: 'Payments', description: 'Payment processing and webhooks' },
    // ── Features (src/features/) ──
    { name: 'Seat Map', description: 'Feature: Seat availability map — src/features/seat_availability_map' },
    { name: 'Schedule', description: 'Feature: Event schedule grouped by venue — src/features/event_schedule' },
    { name: 'Waitlist', description: 'Feature: Waitlist management for sold-out events — src/features/waitlist_management' },
    { name: 'Ticket Transfer', description: 'Feature: Transfer tickets between users — src/features/ticket_transfer' },
    { name: 'Dynamic Pricing', description: 'Feature: Dynamic pricing based on demand — src/features/dynamic_pricing' },
    { name: 'Refund Processing', description: 'Feature: Tiered refund processing — src/features/refund_processing' },
  ],
};

const options = {
  swaggerDefinition,
  apis: [], // No JSDoc annotations — spec is fully defined above
};

export const swaggerSpec = swaggerJsdoc(options);
