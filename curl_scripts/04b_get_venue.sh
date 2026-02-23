#!/bin/bash
# Get Venue - Retrieve venue details by ID

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

VENUE_ID="${VENUE_ID:-$(read_arg 'venue_id' '')}"

if [ -z "$VENUE_ID" ]; then
  echo "Error: VENUE_ID must be set"
  echo "Run ./04_create_venue.sh first or edit arguments.json"
  exit 1
fi

echo "==> Get Venue By ID"
echo "Venue ID: $VENUE_ID"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/venues/${VENUE_ID}")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Tip: Pass a different venue ID directly:"
echo "  VENUE_ID=<id> ./04b_get_venue.sh"
