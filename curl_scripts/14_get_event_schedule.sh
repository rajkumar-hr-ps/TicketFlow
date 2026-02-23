#!/bin/bash
# Get Event Schedule - View upcoming events grouped by venue within a date range

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

# Default: from today to 90 days from now
if command -v python3 &> /dev/null; then
  DEFAULT_START=$(python3 -c "from datetime import datetime; print(datetime.utcnow().strftime('%Y-%m-%dT00:00:00Z'))")
  DEFAULT_END=$(python3 -c "from datetime import datetime, timedelta; print((datetime.utcnow() + timedelta(days=90)).strftime('%Y-%m-%dT23:59:59Z'))")
else
  DEFAULT_START=$(date -u '+%Y-%m-%dT00:00:00Z')
  DEFAULT_END=$(date -u -d "+90 days" '+%Y-%m-%dT23:59:59Z' 2>/dev/null || date -u -v+90d '+%Y-%m-%dT23:59:59Z')
fi

START_DATE="${START_DATE:-$(read_arg 'start_date' "$DEFAULT_START")}"
END_DATE="${END_DATE:-$(read_arg 'end_date' "$DEFAULT_END")}"

echo "==> Get Event Schedule"
echo "Period: $START_DATE to $END_DATE"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/events/schedule?start_date=${START_DATE}&end_date=${END_DATE}")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Note: Only events with status 'on_sale' or 'sold_out' appear in the schedule."
echo "Draft, published, completed, and cancelled events are excluded."
echo "Events are grouped by venue and include price ranges and availability."
echo ""
echo "If no events appear, make sure you have advanced at least one event to 'on_sale':"
echo "  ./09_update_event_status.sh"
echo ""
echo "Tip: Narrow the date range:"
echo "  START_DATE=2026-03-01T00:00:00Z END_DATE=2026-03-31T23:59:59Z ./14_get_event_schedule.sh"
