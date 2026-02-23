#!/bin/bash
# Create Event - Create an event with venue sections

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
VENUE_ID="${VENUE_ID:-$(read_arg 'venue_id' '')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

if [ -z "$VENUE_ID" ]; then
  echo "Error: VENUE_ID must be set"
  echo "Run ./04_create_venue.sh first or edit arguments.json"
  exit 1
fi

# Default: event 30 days from now, lasting 3 hours
if command -v python3 &> /dev/null; then
  START_DATE=$(python3 -c "from datetime import datetime, timedelta; print((datetime.utcnow() + timedelta(days=30)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
  END_DATE=$(python3 -c "from datetime import datetime, timedelta; print((datetime.utcnow() + timedelta(days=30, hours=3)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
else
  START_DATE=$(date -u -d "+30 days" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+30d '+%Y-%m-%dT%H:%M:%SZ')
  END_DATE=$(date -u -d "+30 days +3 hours" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+30d -v+3H '+%Y-%m-%dT%H:%M:%SZ')
fi

# Auto-increment event counter for unique names
EVENT_COUNTER=$(read_arg 'event_counter' '0')
EVENT_COUNTER=$((EVENT_COUNTER + 1))

EVENT_TITLE="${EVENT_TITLE:-Rock Concert ${EVENT_COUNTER}}"
EVENT_CATEGORY="${EVENT_CATEGORY:-concert}"

echo "==> Create Event"
echo "Title: $EVENT_TITLE | Category: $EVENT_CATEGORY"
echo "Venue: $VENUE_ID"
echo "Start: $START_DATE | End: $END_DATE"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/events" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{
    \"title\": \"${EVENT_TITLE}\",
    \"description\": \"An amazing live event\",
    \"venue_id\": \"${VENUE_ID}\",
    \"start_date\": \"${START_DATE}\",
    \"end_date\": \"${END_DATE}\",
    \"category\": \"${EVENT_CATEGORY}\",
    \"sections\": [
      {\"name\": \"VIP\", \"capacity\": 100, \"base_price\": 150},
      {\"name\": \"General\", \"capacity\": 500, \"base_price\": 50}
    ]
  }")

check_response "$RESPONSE"
format_json "$RESPONSE"
check_error "$RESPONSE" "Create event"

EVENT_ID=$(extract_json_value "$RESPONSE" "event._id")

echo ""
if [ -n "$EVENT_ID" ]; then
  write_arg "event_id" "$EVENT_ID"
  write_arg "event_counter" "$EVENT_COUNTER"
  echo "✓ Event ID saved to arguments.json"
  echo ""
  echo "Next: ./09_update_event_status.sh (to publish and put on sale)"
  echo ""
  echo "Note: Events are created in 'draft' status. You must transition through"
  echo "the lifecycle before tickets can be ordered:"
  echo "  draft -> published -> on_sale -> sold_out / completed / cancelled"
  echo ""
  echo "Overlapping events on the same venue and date are allowed while in 'draft'."
  echo "The overlap check is enforced only when publishing the event."
  echo ""
  echo "Tip: Override event details with env vars:"
  echo "  EVENT_TITLE=\"Jazz Night\" EVENT_CATEGORY=concert ./06_create_event.sh"
else
  echo "✗ Event creation failed - ID not found in response"
  exit 1
fi
