#!/bin/bash
# Payment Webhook - Simulate a payment webhook callback
# Note: Requires valid HMAC signature — this script demonstrates the endpoint structure

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

WEBHOOK_EVENT_ID="${WEBHOOK_EVENT_ID:-webhook_$(date +%s)}"
PAYMENT_ID="${PAYMENT_ID:-payment_test_123}"
PAYMENT_STATUS="${PAYMENT_STATUS:-completed}"
AMOUNT="${AMOUNT:-100}"
PAYMENT_METHOD="${PAYMENT_METHOD:-credit_card}"
SIGNATURE="${SIGNATURE:-test_signature}"

echo "==> Payment Webhook (Simulated)"
echo "Event ID: $WEBHOOK_EVENT_ID | Status: $PAYMENT_STATUS"
echo "Note: Requires valid x-webhook-signature header for production"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/webhook" \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: ${SIGNATURE}" \
  -d "{
    \"webhook_event_id\": \"${WEBHOOK_EVENT_ID}\",
    \"payment_id\": \"${PAYMENT_ID}\",
    \"status\": \"${PAYMENT_STATUS}\",
    \"amount\": ${AMOUNT},
    \"payment_method\": \"${PAYMENT_METHOD}\"
  }")

check_response "$RESPONSE"
format_json "$RESPONSE"
echo ""
