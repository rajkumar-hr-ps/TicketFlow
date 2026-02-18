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
            enum: ['pending', 'confirmed', 'cancelled', 'refunded', 'partially_refunded'],
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
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title', 'venue_id', 'start_date', 'end_date', 'category'],
                properties: {
                  title: { type: 'string', example: 'Rock Concert 2026' },
                  description: { type: 'string', example: 'An amazing rock concert' },
                  venue_id: { type: 'string' },
                  start_date: { type: 'string', format: 'date-time' },
                  end_date: { type: 'string', format: 'date-time' },
                  category: {
                    type: 'string',
                    enum: ['concert', 'sports', 'theater', 'conference', 'festival', 'comedy'],
                  },
                  sections: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['name', 'capacity', 'base_price'],
                      properties: {
                        name: { type: 'string', example: 'VIP' },
                        capacity: { type: 'integer', minimum: 1, example: 100 },
                        base_price: { type: 'number', minimum: 0, example: 150.0 },
                      },
                    },
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
                    enum: ['draft', 'published', 'on_sale', 'sold_out', 'completed', 'cancelled'],
                  },
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
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['event_id'],
                properties: {
                  event_id: { type: 'string' },
                  section_id: { type: 'string', description: 'Required for single-section orders' },
                  quantity: { type: 'integer', minimum: 1, description: 'Required for single-section orders' },
                  promo_code: { type: 'string' },
                  idempotency_key: { type: 'string' },
                  sections: {
                    type: 'array',
                    description: 'For multi-section orders (alternative to section_id + quantity)',
                    items: {
                      type: 'object',
                      required: ['section_id', 'quantity'],
                      properties: {
                        section_id: { type: 'string' },
                        quantity: { type: 'integer', minimum: 1 },
                      },
                    },
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
    '/orders/{id}/refund': {
      post: {
        tags: ['Orders'],
        summary: 'Process a refund for an order (tiered by time until event)',
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

    // ==================== Promo Codes ====================
    '/promo-codes': {
      post: {
        tags: ['Promo Codes'],
        summary: 'Create a promo code',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['code', 'discount_type', 'discount_value', 'max_uses', 'valid_from', 'valid_to'],
                properties: {
                  code: { type: 'string', example: 'SUMMER20' },
                  event_id: { type: 'string', nullable: true, description: 'Null for platform-wide codes' },
                  discount_type: { type: 'string', enum: ['percentage', 'fixed'] },
                  discount_value: { type: 'number', minimum: 0, example: 20 },
                  max_uses: { type: 'integer', minimum: 1, example: 100 },
                  valid_from: { type: 'string', format: 'date-time' },
                  valid_to: { type: 'string', format: 'date-time' },
                  min_tickets: { type: 'integer', default: 1 },
                  max_discount_amount: { type: 'number', nullable: true },
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
        summary: 'Payment webhook endpoint (HMAC signature verified)',
        parameters: [
          {
            name: 'x-webhook-signature',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'HMAC signature for webhook verification',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  webhook_event_id: { type: 'string' },
                  payment_id: { type: 'string' },
                  status: { type: 'string', enum: ['completed', 'failed'] },
                  amount: { type: 'number' },
                  payment_method: {
                    type: 'string',
                    enum: ['credit_card', 'debit_card', 'wallet'],
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

    // ==================== Seat Map ====================
    '/events/{id}/sections/{sectionId}/seat-map': {
      get: {
        tags: ['Seat Map'],
        summary: 'Get seat availability map for a section',
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

    // ==================== Schedule ====================
    '/events/schedule': {
      get: {
        tags: ['Schedule'],
        summary: 'Get event schedule grouped by venue',
        parameters: [
          {
            name: 'start_date',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
            description: 'Schedule period start',
          },
          {
            name: 'end_date',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
            description: 'Schedule period end',
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

    // ==================== Waitlist ====================
    '/events/{id}/waitlist': {
      post: {
        tags: ['Waitlist'],
        summary: 'Join the waitlist for a sold-out event',
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

    // ==================== Ticket Transfer ====================
    '/tickets/{id}/transfer': {
      post: {
        tags: ['Ticket Transfer'],
        summary: 'Transfer a ticket to another user by email',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Ticket ID',
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
                  to_email: { type: 'string', format: 'email', example: 'recipient@example.com' },
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

    // ==================== Dynamic Pricing ====================
    '/events/{id}/pricing': {
      get: {
        tags: ['Dynamic Pricing'],
        summary: 'Get dynamic pricing for an event section',
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
  },
  tags: [
    { name: 'Auth', description: 'Authentication and user management' },
    { name: 'Venues', description: 'Venue management' },
    { name: 'Events', description: 'Event creation and management' },
    { name: 'Sections', description: 'Event sections and availability' },
    { name: 'Orders', description: 'Order creation, retrieval, and refunds' },
    { name: 'Promo Codes', description: 'Promotional code management' },
    { name: 'Payments', description: 'Payment processing and webhooks' },
    { name: 'Seat Map', description: 'Seat availability map' },
    { name: 'Schedule', description: 'Event schedule by venue' },
    { name: 'Waitlist', description: 'Waitlist management for sold-out events' },
    { name: 'Ticket Transfer', description: 'Transfer tickets between users' },
    { name: 'Dynamic Pricing', description: 'Dynamic pricing based on demand' },
  ],
};

const options = {
  swaggerDefinition,
  apis: [], // No JSDoc annotations — spec is fully defined above
};

export const swaggerSpec = swaggerJsdoc(options);
