#!/bin/bash
# Verify Barcode - Verify a ticket barcode at event entry

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
BARCODE="${BARCODE:-$(read_arg 'barcode' '')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

if [ -z "$BARCODE" ]; then
  echo "Error: BARCODE must be set"
  echo "Run ./27_generate_barcode.sh first or edit arguments.json"
  exit 1
fi

echo "==> Verify Barcode"
echo "Barcode: $BARCODE"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/tickets/verify-barcode" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"barcode\":\"${BARCODE}\"}")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Note: Returns ticket details and validity status."
echo "Used at event entry to validate admission."
