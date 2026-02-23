#!/bin/bash
# Confirm Ticket - Manually confirm a single held ticket

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
TICKET_ID="${TICKET_ID:-$(read_arg 'ticket_id' '')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

if [ -z "$TICKET_ID" ]; then
  echo "Error: TICKET_ID must be set"
  echo "Run ./19_get_order.sh first or edit arguments.json"
  exit 1
fi

echo "==> Confirm Ticket"
echo "Ticket ID: $TICKET_ID"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/tickets/${TICKET_ID}/confirm" \
  -H "Authorization: Bearer ${TOKEN}")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Note: This manually confirms a single held ticket."
echo "If you already ran ./25_payment_webhook.sh with status 'completed',"
echo "all tickets for that order were auto-confirmed — this step is not needed."
echo ""
echo "Next: ./27_generate_barcode.sh   - Generate a barcode for entry"
