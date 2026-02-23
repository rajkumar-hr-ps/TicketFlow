#!/bin/bash
# List Events - Get events with optional filters

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

# Optional filters
STATUS="${STATUS:-}"
CATEGORY="${CATEGORY:-}"
PAGE="${PAGE:-1}"
LIMIT="${LIMIT:-20}"

QUERY="page=${PAGE}&limit=${LIMIT}"
[ -n "$STATUS" ] && QUERY="${QUERY}&status=${STATUS}"
[ -n "$CATEGORY" ] && QUERY="${QUERY}&category=${CATEGORY}"

echo "==> List Events"
echo "Filters: $QUERY"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/events?${QUERY}")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Tip: Filter events by status or category:"
echo "  STATUS=on_sale ./07_list_events.sh"
echo "  CATEGORY=concert ./07_list_events.sh"
echo "  STATUS=draft CATEGORY=conference ./07_list_events.sh"
echo ""
echo "Valid statuses: draft, published, on_sale, sold_out, completed, cancelled"
echo "Valid categories: concert, sports, theater, conference, festival, comedy"
echo ""
echo "Note: Events follow a lifecycle — only 'on_sale' events accept ticket orders."
echo "Use ./09_update_event_status.sh to transition: draft -> published -> on_sale"
