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
