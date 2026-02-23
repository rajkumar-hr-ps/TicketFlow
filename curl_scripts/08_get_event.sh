#!/bin/bash
# Get Event - Retrieve event details with venue sections and availability

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

# Auto-save first venue_section_id for convenience
VENUE_SECTION_ID=$(echo "$RESPONSE" | jq -r '.venueSections[0]._id // empty' 2>/dev/null)
if [ -n "$VENUE_SECTION_ID" ]; then
  write_arg "venue_section_id" "$VENUE_SECTION_ID"
  echo ""
  echo "✓ First venue section ID ($VENUE_SECTION_ID) saved to arguments.json"
fi

echo ""
echo "Tip: The response includes venueSections with 'available' seat counts."
echo "Use venue section IDs from above for:"
echo "  ./11_get_section_availability.sh   - Detailed availability"
echo "  ./12_get_seat_map.sh               - Seat map with pricing"
echo "  ./17_create_order.sh               - Order tickets"
