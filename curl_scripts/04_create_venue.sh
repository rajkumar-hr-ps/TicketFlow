#!/bin/bash
# Create Venue - Create a new venue with an auto-incremented name
# Each run generates a unique venue name (e.g., Grand Arena-1, Grand Arena-2, ...)

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

# Auto-increment venue counter for unique names
VENUE_COUNTER=$(read_arg 'venue_counter' '0')
VENUE_COUNTER=$((VENUE_COUNTER + 1))

VENUE_NAME="${VENUE_NAME:-Grand Arena-${VENUE_COUNTER}}"
VENUE_ADDRESS="${VENUE_ADDRESS:-${VENUE_COUNTER} Main Street}"
VENUE_CITY="${VENUE_CITY:-New York}"
VENUE_CAPACITY="${VENUE_CAPACITY:-5000}"

echo "==> Create Venue"
echo "Name: $VENUE_NAME | City: $VENUE_CITY | Capacity: $VENUE_CAPACITY"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/venues" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"name\":\"${VENUE_NAME}\",\"address\":\"${VENUE_ADDRESS}\",\"city\":\"${VENUE_CITY}\",\"total_capacity\":${VENUE_CAPACITY}}")

check_response "$RESPONSE"
format_json "$RESPONSE"
check_error "$RESPONSE" "Create venue"

VENUE_ID=$(extract_json_value "$RESPONSE" "venue._id")

echo ""
if [ -n "$VENUE_ID" ]; then
  write_arg "venue_id" "$VENUE_ID"
  write_arg "venue_counter" "$VENUE_COUNTER"
  echo "✓ Venue ID saved to arguments.json"
  echo ""
  echo "Next: ./04b_get_venue.sh or ./06_create_event.sh"
  echo ""
  echo "Tip: Override venue details with env vars:"
  echo "  VENUE_NAME=\"Stadium X\" VENUE_CITY=\"Chicago\" VENUE_CAPACITY=10000 ./04_create_venue.sh"
else
  echo "✗ Venue creation failed - ID not found in response"
  exit 1
fi
