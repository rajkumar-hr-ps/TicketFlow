#!/bin/bash
# Get Profile - Retrieve authenticated user's profile

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

echo "==> Get Current User Profile"
RESPONSE=$(curl -s -X GET "${BASE_URL}/api/v1/auth/me" \
  -H "Authorization: Bearer ${TOKEN}")

check_response "$RESPONSE"
format_json "$RESPONSE"
echo ""
