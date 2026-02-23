# Helper curl Scripts

## Available Scripts

### Auth
1. **01_register_user.sh** - Register a new user (auto-generates email)
2. **02_login.sh** - Login and get access token
3. **03_get_profile.sh** - Get current user profile

### Venues
4. **04_create_venue.sh** - Create a new venue
5. **05_list_venues.sh** - List all venues

### Events
6. **06_create_event.sh** - Create an event with VIP + General sections
7. **07_list_events.sh** - List events with optional filters
8. **08_get_event.sh** - Get event details with sections
9. **09_update_event_status.sh** - Transition event status (draft -> published -> on_sale)

### Sections & Availability
10. **10_get_sections.sh** - List sections for an event
11. **11_get_section_availability.sh** - Check seat availability
12. **12_get_seat_map.sh** - Seat availability map with pricing

### Pricing & Schedule
13. **13_get_dynamic_pricing.sh** - View dynamic pricing for a section
14. **14_get_event_schedule.sh** - Events grouped by venue in date range

### Promo Codes
15. **15_create_promo_code.sh** - Create a discount promo code
16. **16_validate_promo_code.sh** - Validate a promo code

### Orders
17. **17_create_order.sh** - Place an order for tickets
18. **18_list_orders.sh** - List your orders
19. **19_get_order.sh** - Get order details with tickets
20. **20_get_order_payments.sh** - View payments for an order

### Refunds & Advanced Features
21. **21_process_refund.sh** - Refund an order (tiered by time)
22. **22_join_waitlist.sh** - Join waitlist for sold-out event
23. **23_get_waitlist_position.sh** - Check waitlist position
24. **24_transfer_ticket.sh** - Transfer ticket to another user
25. **25_payment_webhook.sh** - Simulate payment webhook

---

## How It Works

1. **arguments.json** stores all state (credentials, tokens, IDs)
2. Scripts **automatically read** from this file
3. Scripts **automatically write** successful results back
4. You can **manually edit** `arguments.json` to customize parameters

---

## Quick Start (Full Flow)

```bash
# 1. Register and login
./01_register_user.sh
./02_login.sh

# 2. Create venue and event
./04_create_venue.sh
./06_create_event.sh

# 3. Put event on sale (two status transitions)
NEW_STATUS=published ./09_update_event_status.sh
NEW_STATUS=on_sale ./09_update_event_status.sh

# 4. Browse event and sections
./08_get_event.sh
./10_get_sections.sh
./12_get_seat_map.sh
./13_get_dynamic_pricing.sh

# 5. Create promo code and order
./15_create_promo_code.sh
./17_create_order.sh

# 6. View order and payments
./19_get_order.sh
./20_get_order_payments.sh
```

---

## Customization

Edit `arguments.json` to change parameters:

```json
{
  "email": "custom@example.com",
  "password": "MyPassword123!",
  "event_id": "event-object-id",
  "venue_section_id": "section-object-id",
  "quantity": "4",
  "promo_code": "SAVE20"
}
```

### Environment Variables

Override any parameter via environment variables:

```bash
# Use a different server
BASE_URL=http://localhost:8080 ./01_register_user.sh

# Custom event details
EVENT_TITLE="Jazz Night" EVENT_CATEGORY=concert ./06_create_event.sh

# Custom venue
VENUE_NAME="City Hall" VENUE_CITY="Chicago" VENUE_CAPACITY=2000 ./04_create_venue.sh

# Custom order quantity
QUANTITY=5 ./17_create_order.sh

# Transfer to specific user
TO_EMAIL=friend@example.com ./24_transfer_ticket.sh
```

---

## For Ticket Transfer (Script 24)

1. Register a second user: `EMAIL=friend@example.com ./01_register_user.sh`
2. Login as the original user: `./02_login.sh`
3. Set recipient: edit `arguments.json` and set `to_email` to `friend@example.com`
4. Run: `./24_transfer_ticket.sh`

## For Waitlist (Scripts 22-23)

The event must be in `sold_out` status:
1. `NEW_STATUS=sold_out ./09_update_event_status.sh`
2. `./22_join_waitlist.sh`
3. `./23_get_waitlist_position.sh`

---

## Notes

- Scripts use `jq` for JSON parsing (falls back to `python3 -m json.tool`)
- All scripts source `common.sh` for shared functions
- Default server: `http://localhost:3000`
- Default role for registration: `organizer` (can create events/venues)
- Event is created 30 days in the future with VIP ($150) and General ($50) sections
