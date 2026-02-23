#!/bin/bash
# Validate Promo Code - Check if a promo code is valid

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
PROMO_CODE="${PROMO_CODE:-$(read_arg 'promo_code' '')}"
EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"
QUANTITY="${QUANTITY:-$(read_arg 'quantity' '2')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

if [ -z "$PROMO_CODE" ]; then
  echo "Error: PROMO_CODE must be set"
  echo "Run ./15_create_promo_code.sh first or edit arguments.json"
  exit 1
fi

QUERY="quantity=${QUANTITY}"
[ -n "$EVENT_ID" ] && QUERY="${QUERY}&event_id=${EVENT_ID}"

echo "==> Validate Promo Code"
echo "Code: $PROMO_CODE | Quantity: $QUANTITY"
echo ""

RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/promo-codes/${PROMO_CODE}/validate?${QUERY}" \
  -H "Authorization: Bearer ${TOKEN}")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Tip: Validate a different code or quantity:"
echo "  PROMO_CODE=FLAT10 QUANTITY=5 ./16_validate_promo_code.sh"
