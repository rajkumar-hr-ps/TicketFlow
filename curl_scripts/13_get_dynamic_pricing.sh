#!/bin/bash
# Get Dynamic Pricing - View dynamic pricing for a section

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"
SECTION_ID="${SECTION_ID:-$(read_arg 'section_id' '')}"
QUANTITY="${QUANTITY:-$(read_arg 'quantity' '2')}"

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

echo "==> Get Dynamic Pricing"
echo "Event: $EVENT_ID | Section: $SECTION_ID | Quantity: $QUANTITY"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/events/${EVENT_ID}/pricing?section_id=${SECTION_ID}&quantity=${QUANTITY}" \
  -H "Authorization: Bearer ${TOKEN}")

check_response "$RESPONSE"
format_json "$RESPONSE"
echo ""
