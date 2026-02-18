#!/bin/bash
# Create Order - Place an order for tickets

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"
SECTION_ID="${SECTION_ID:-$(read_arg 'section_id' '')}"
QUANTITY="${QUANTITY:-$(read_arg 'quantity' '2')}"
PROMO_CODE="${PROMO_CODE:-$(read_arg 'promo_code' '')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

if [ -z "$EVENT_ID" ] || [ -z "$SECTION_ID" ]; then
  echo "Error: EVENT_ID and SECTION_ID must be set"
  echo "Run ./06_create_event.sh and ./10_get_sections.sh first"
  exit 1
fi

echo "==> Create Order"
echo "Event: $EVENT_ID | Section: $SECTION_ID | Quantity: $QUANTITY"

# Build JSON body
BODY="{\"event_id\":\"${EVENT_ID}\",\"section_id\":\"${SECTION_ID}\",\"quantity\":${QUANTITY}"
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
  echo "✓ You can now run: ./18_list_orders.sh"
else
  echo "✗ Order creation failed - ID not found in response"
  exit 1
fi
