#!/bin/bash
# Get Venue Section Availability - Check available seats in a venue section

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"
VENUE_SECTION_ID="${VENUE_SECTION_ID:-$(read_arg 'venue_section_id' '')}"

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

echo "==> Get Venue Section Availability"
echo "Event: $EVENT_ID | Venue Section: $VENUE_SECTION_ID"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/events/${EVENT_ID}/venue-sections/${VENUE_SECTION_ID}/availability")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Tip: Available = capacity - sold_count - held_count"
echo "Held tickets expire after a timeout and become available again."
