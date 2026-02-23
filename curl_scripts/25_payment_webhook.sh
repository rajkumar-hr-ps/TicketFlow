#!/bin/bash
# Payment Webhook - Simulate a payment gateway callback to complete payment

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

PAYMENT_ID="${PAYMENT_ID:-$(read_arg 'payment_id' '')}"
AMOUNT="${AMOUNT:-$(read_arg 'payment_amount' '')}"
PAYMENT_STATUS="${PAYMENT_STATUS:-completed}"
WEBHOOK_EVENT_ID="${WEBHOOK_EVENT_ID:-webhook_$(date +%s)}"

if [ -z "$PAYMENT_ID" ]; then
  echo "Error: PAYMENT_ID must be set"
  echo "Run ./20_get_order_payments.sh first to fetch and save the payment ID"
  exit 1
fi

if [ -z "$AMOUNT" ]; then
  echo "Error: AMOUNT must be set"
  echo "Run ./20_get_order_payments.sh first to fetch and save the payment amount"
  exit 1
fi

echo "==> Payment Webhook"
echo "Payment ID: $PAYMENT_ID | Amount: $AMOUNT | Status: $PAYMENT_STATUS"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/webhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"webhook_event_id\": \"${WEBHOOK_EVENT_ID}\",
    \"payment_id\": \"${PAYMENT_ID}\",
    \"status\": \"${PAYMENT_STATUS}\",
    \"amount\": ${AMOUNT}
  }")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Note: On 'completed' status, the webhook automatically:"
echo "  1. Updates payment status to 'completed'"
echo "  2. Confirms the order (status -> confirmed, payment_status -> paid)"
echo "  3. Confirms all held tickets (held -> confirmed)"
echo ""
echo "Next: ./26_confirm_ticket.sh is already done by the webhook."
echo "       Skip to ./27_generate_barcode.sh to get a barcode for entry."
echo ""
echo "Tip: Simulate a failed payment instead:"
echo "  PAYMENT_STATUS=failed ./25_payment_webhook.sh"
