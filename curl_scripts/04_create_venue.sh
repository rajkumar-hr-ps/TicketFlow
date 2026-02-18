#!/bin/bash
# Create Venue - Create a new venue

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
VENUE_NAME="${VENUE_NAME:-Grand Arena}"
VENUE_ADDRESS="${VENUE_ADDRESS:-123 Main Street}"
VENUE_CITY="${VENUE_CITY:-New York}"
VENUE_CAPACITY="${VENUE_CAPACITY:-5000}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

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
  echo "✓ Venue ID saved to arguments.json"
  echo "✓ You can now run: ./06_create_event.sh"
else
  echo "✗ Venue creation failed - ID not found in response"
  exit 1
fi
