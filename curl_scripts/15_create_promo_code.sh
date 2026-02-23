#!/bin/bash
# Create Promo Code - Create a discount promo code

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
EVENT_ID="${EVENT_ID:-$(read_arg 'event_id' '')}"

PROMO_CODE="${PROMO_CODE:-SAVE20}"
DISCOUNT_TYPE="${DISCOUNT_TYPE:-percentage}"
DISCOUNT_VALUE="${DISCOUNT_VALUE:-20}"
MAX_USES="${MAX_USES:-100}"

# Valid from now to 90 days from now
if command -v python3 &> /dev/null; then
  VALID_FROM=$(python3 -c "from datetime import datetime; print(datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'))")
  VALID_TO=$(python3 -c "from datetime import datetime, timedelta; print((datetime.utcnow() + timedelta(days=90)).strftime('%Y-%m-%dT%H:%M:%SZ'))")
else
  VALID_FROM=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  VALID_TO=$(date -u -d "+90 days" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+90d '+%Y-%m-%dT%H:%M:%SZ')
fi

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

echo "==> Create Promo Code"
echo "Code: $PROMO_CODE | Type: $DISCOUNT_TYPE | Value: $DISCOUNT_VALUE | Max Uses: $MAX_USES"
echo ""

# Build JSON body — include event_id if set
if [ -n "$EVENT_ID" ]; then
  BODY="{\"code\":\"${PROMO_CODE}\",\"event_id\":\"${EVENT_ID}\",\"discount_type\":\"${DISCOUNT_TYPE}\",\"discount_value\":${DISCOUNT_VALUE},\"max_uses\":${MAX_USES},\"valid_from\":\"${VALID_FROM}\",\"valid_to\":\"${VALID_TO}\"}"
else
  BODY="{\"code\":\"${PROMO_CODE}\",\"discount_type\":\"${DISCOUNT_TYPE}\",\"discount_value\":${DISCOUNT_VALUE},\"max_uses\":${MAX_USES},\"valid_from\":\"${VALID_FROM}\",\"valid_to\":\"${VALID_TO}\"}"
fi

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/promo-codes" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "$BODY")

check_response "$RESPONSE"
format_json "$RESPONSE"
check_error "$RESPONSE" "Create promo code"

echo ""
write_arg "promo_code" "$PROMO_CODE"
echo "✓ Promo code saved to arguments.json"
echo ""
echo "Next: ./16_validate_promo_code.sh"
echo ""
echo "Tip: Create a flat discount or event-specific promo:"
echo "  PROMO_CODE=FLAT10 DISCOUNT_TYPE=flat DISCOUNT_VALUE=10 ./15_create_promo_code.sh"
echo "  PROMO_CODE=VIP50 DISCOUNT_TYPE=percentage DISCOUNT_VALUE=50 ./15_create_promo_code.sh"
