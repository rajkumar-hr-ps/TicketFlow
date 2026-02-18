#!/bin/bash
# Join Waitlist - Join the waitlist for a sold-out event

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"

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

echo "==> Join Waitlist"
echo "Event ID: $EVENT_ID"
echo "Note: Event must be in 'sold_out' status"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/events/${EVENT_ID}/waitlist" \
  -H "Authorization: Bearer ${TOKEN}")

check_response "$RESPONSE"
format_json "$RESPONSE"
echo ""
