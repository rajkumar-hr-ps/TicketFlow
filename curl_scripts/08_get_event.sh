#!/bin/bash
# Get Event - Retrieve event details with sections

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"

if [ -z "$EVENT_ID" ]; then
  echo "Error: EVENT_ID must be set"
  echo "Run ./06_create_event.sh first or edit arguments.json"
  exit 1
fi

echo "==> Get Event By ID"
echo "Event ID: $EVENT_ID"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/events/${EVENT_ID}")

check_response "$RESPONSE"
format_json "$RESPONSE"

# Auto-save first section_id for convenience
SECTION_ID=$(echo "$RESPONSE" | jq -r '.sections[0]._id // empty' 2>/dev/null)
if [ -n "$SECTION_ID" ]; then
  write_arg "section_id" "$SECTION_ID"
  echo ""
  echo "✓ First section ID ($SECTION_ID) saved to arguments.json"
fi

echo ""
