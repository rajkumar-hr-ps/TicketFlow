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

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/orders/${ORDER_ID}/payments" \
  -H "Authorization: Bearer ${TOKEN}")

check_response "$RESPONSE"
format_json "$RESPONSE"

# Auto-save first payment_id and amount for the webhook script
PAYMENT_ID=$(echo "$RESPONSE" | jq -r '.payments[0]._id // empty' 2>/dev/null)
PAYMENT_AMOUNT=$(echo "$RESPONSE" | jq -r '.payments[0].amount // empty' 2>/dev/null)
if [ -n "$PAYMENT_ID" ]; then
  write_arg "payment_id" "$PAYMENT_ID"
  write_arg "payment_amount" "$PAYMENT_AMOUNT"
  echo ""
  echo "✓ Payment ID ($PAYMENT_ID) saved to arguments.json"
  echo "✓ Payment amount ($PAYMENT_AMOUNT) saved to arguments.json"
fi

echo ""
echo "Note: Payments start as 'pending'. To complete the payment flow:"
echo "  ./25_payment_webhook.sh   - Simulate payment gateway confirmation"
