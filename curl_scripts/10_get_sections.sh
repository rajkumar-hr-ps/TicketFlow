#!/bin/bash
# Get Venue Sections - List venue sections for an event

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"

if [ -z "$EVENT_ID" ]; then
  echo "Error: EVENT_ID must be set"
  echo "Run ./06_create_event.sh first or edit arguments.json"
  exit 1
fi

echo "==> Get Venue Sections"
echo "Event ID: $EVENT_ID"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/events/${EVENT_ID}/venue-sections")

check_response "$RESPONSE"
format_json "$RESPONSE"

# Auto-save first venue_section_id
VENUE_SECTION_ID=$(echo "$RESPONSE" | jq -r '.venueSections[0]._id // empty' 2>/dev/null)
if [ -n "$VENUE_SECTION_ID" ]; then
  write_arg "venue_section_id" "$VENUE_SECTION_ID"
  echo ""
  echo "✓ First venue section ID ($VENUE_SECTION_ID) saved to arguments.json"
fi

echo ""
echo "Tip: Use a venue section ID from above for:"
echo "  ./11_get_section_availability.sh   - Check available seats"
echo "  ./12_get_seat_map.sh               - Seat map with pricing"
echo "  ./13_get_dynamic_pricing.sh        - Current pricing tier"
