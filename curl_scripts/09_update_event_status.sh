#!/bin/bash
# Update Event Status - Transition event through the status lifecycle

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"
NEW_STATUS="${NEW_STATUS:-published}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

if [ -z "$EVENT_ID" ]; then
  echo "Error: EVENT_ID must be set"
  echo "Run ./06_create_event.sh first or edit arguments.json"
  exit 1
fi

echo "==> Update Event Status"
echo "Event ID: $EVENT_ID"
echo "New Status: $NEW_STATUS"
echo ""

RESPONSE=$(curl -s -X PATCH "${BASE_URL}/api/v1/events/${EVENT_ID}/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"status\":\"${NEW_STATUS}\"}")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Tip: Run this script multiple times to advance the lifecycle:"
echo "  NEW_STATUS=published ./09_update_event_status.sh"
echo "  NEW_STATUS=on_sale   ./09_update_event_status.sh"
echo ""
echo "Valid transitions:"
echo "  draft -> published -> on_sale -> sold_out / completed / cancelled"
echo ""
echo "Note: Events must be 'on_sale' before customers can order tickets."
