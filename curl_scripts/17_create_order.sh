#!/bin/bash
# Create Order - Place an order for tickets

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"
VENUE_SECTION_ID="${VENUE_SECTION_ID:-$(read_arg 'venue_section_id' '')}"
QUANTITY="${QUANTITY:-$(read_arg 'quantity' '2')}"
PROMO_CODE="${PROMO_CODE:-$(read_arg 'promo_code' '')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

if [ -z "$EVENT_ID" ]; then
  echo "Error: EVENT_ID must be set"
  echo "Run ./06_create_event.sh first or edit arguments.json"
  exit 1
fi

if [ -z "$VENUE_SECTION_ID" ]; then
  echo "Error: VENUE_SECTION_ID must be set"
  echo "Run ./10_get_sections.sh first or edit arguments.json"
  exit 1
fi

echo "==> Create Order"
echo "Event: $EVENT_ID | Venue Section: $VENUE_SECTION_ID | Quantity: $QUANTITY"

# Build JSON body
BODY="{\"event_id\":\"${EVENT_ID}\",\"section_id\":\"${VENUE_SECTION_ID}\",\"quantity\":${QUANTITY}"
if [ -n "$PROMO_CODE" ]; then
  BODY="${BODY},\"promo_code\":\"${PROMO_CODE}\""
  echo "Promo: $PROMO_CODE"
fi
BODY="${BODY}}"

echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/orders" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "$BODY")

check_response "$RESPONSE"
format_json "$RESPONSE"
check_error "$RESPONSE" "Create order"

ORDER_ID=$(extract_json_value "$RESPONSE" "order._id")
# Extract first ticket ID from the order's tickets array
TICKET_ID=$(echo "$RESPONSE" | jq -r '.order.tickets[0] // empty' 2>/dev/null)

echo ""
if [ -n "$ORDER_ID" ]; then
  write_arg "order_id" "$ORDER_ID"
  echo "✓ Order ID ($ORDER_ID) saved to arguments.json"
  if [ -n "$TICKET_ID" ]; then
    write_arg "ticket_id" "$TICKET_ID"
    echo "✓ Ticket ID ($TICKET_ID) saved to arguments.json"
  fi
  echo ""
  echo "Next: ./18_list_orders.sh or ./20_get_order_payments.sh"
  echo ""
  echo "Note: The event must be in 'on_sale' status to accept orders."
  echo "Tickets are held temporarily — complete payment via webhook to confirm."
  echo ""
  echo "Tip: Order with a promo code:"
  echo "  PROMO_CODE=SAVE20 QUANTITY=3 ./17_create_order.sh"
else
  echo "✗ Order creation failed"
  echo "  Common causes:"
  echo "    - Event is not in 'on_sale' status (run ./09_update_event_status.sh)"
  echo "    - Venue section has insufficient capacity"
  echo "    - Invalid event or venue section ID"
  exit 1
fi
