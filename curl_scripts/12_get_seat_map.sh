#!/bin/bash
# Get Seat Map - Seat availability map with pricing

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"
SECTION_ID="${SECTION_ID:-$(read_arg 'section_id' '')}"

if [ -z "$EVENT_ID" ]; then
  echo "Error: EVENT_ID must be set"
  echo "Run ./06_create_event.sh first or edit arguments.json"
  exit 1
fi

if [ -z "$SECTION_ID" ]; then
  echo "Error: SECTION_ID must be set"
  echo "Run ./10_get_sections.sh first or edit arguments.json"
  exit 1
fi

echo "==> Get Seat Availability Map"
echo "Event: $EVENT_ID | Section: $SECTION_ID"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/events/${EVENT_ID}/sections/${SECTION_ID}/seat-map")

check_response "$RESPONSE"
format_json "$RESPONSE"
echo ""
