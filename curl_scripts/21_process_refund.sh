#!/bin/bash
# Process Refund - Refund an order (tiered by time until event)

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
ORDER_ID="${ORDER_ID:-$(read_arg 'order_id' '')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

if [ -z "$ORDER_ID" ]; then
  echo "Error: ORDER_ID must be set"
  echo "Run ./17_create_order.sh first or edit arguments.json"
  exit 1
fi

echo "==> Process Refund"
echo "Order ID: $ORDER_ID"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/orders/${ORDER_ID}/refund" \
  -H "Authorization: Bearer ${TOKEN}")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Note: Refund amount is tiered based on time until event:"
echo "  72+ hours before  = 100% refund"
echo "  24-72 hours       = 50% refund"
echo "  <24 hours         = no refund"
