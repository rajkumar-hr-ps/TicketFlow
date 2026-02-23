#!/bin/bash
# List Venues - Get all venues

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

echo "==> List All Venues"
RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/venues")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Tip: Copy a venue _id from above and use it:"
echo "  VENUE_ID=<id> ./04b_get_venue.sh"
