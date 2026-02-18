#!/bin/bash
# Get Order Payments - List payments for an order

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

echo "==> Get Payments for Order"
echo "Order ID: $ORDER_ID"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/payments/orders/${ORDER_ID}/payments" \
  -H "Authorization: Bearer ${TOKEN}")

check_response "$RESPONSE"
format_json "$RESPONSE"
echo ""
