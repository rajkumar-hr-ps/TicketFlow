#!/bin/bash
# Generate Barcode - Generate a barcode for a confirmed ticket

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

echo "==> Generate Barcode"
echo "Ticket ID: $TICKET_ID"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/tickets/${TICKET_ID}/barcode" \
  -H "Authorization: Bearer ${TOKEN}")

check_response "$RESPONSE"
format_json "$RESPONSE"

# Auto-save barcode for verification
BARCODE=$(echo "$RESPONSE" | jq -r '.barcode // empty' 2>/dev/null)
if [ -n "$BARCODE" ]; then
  write_arg "barcode" "$BARCODE"
  echo ""
  echo "✓ Barcode saved to arguments.json"
fi

echo ""
echo "Note: The ticket must be confirmed before a barcode can be generated."
echo ""
echo "Next: ./28_verify_barcode.sh   - Verify the barcode at entry"
