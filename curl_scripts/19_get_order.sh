#!/bin/bash
# Get Order - Retrieve order details with tickets

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
ORDER_ID="${ORDER_ID:-$(read_arg 'order_id' '')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

if [ -z "$ORDER_ID" ]; then
  echo "Error: ORDER_ID must be set"
  echo "Run ./17_create_order.sh first or edit arguments.json"
  exit 1
fi

echo "==> Get Order By ID"
echo "Order ID: $ORDER_ID"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/orders/${ORDER_ID}" \
  -H "Authorization: Bearer ${TOKEN}")

check_response "$RESPONSE"
format_json "$RESPONSE"

# Auto-save first ticket_id from populated tickets
TICKET_ID=$(echo "$RESPONSE" | jq -r '.order.tickets[0]._id // .order.tickets[0] // empty' 2>/dev/null)
if [ -n "$TICKET_ID" ]; then
  write_arg "ticket_id" "$TICKET_ID"
  echo ""
  echo "✓ Ticket ID ($TICKET_ID) saved to arguments.json"
fi

echo ""
echo "Tip: Use the ticket ID for:"
echo "  ./24_transfer_ticket.sh   - Transfer to another user"
