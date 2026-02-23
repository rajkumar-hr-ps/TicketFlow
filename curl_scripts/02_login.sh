#!/bin/bash
# Login - Authenticate and get access token

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

EMAIL="${EMAIL:-$(read_arg 'email' '')}"
PASSWORD="${PASSWORD:-$(read_arg 'password' '')}"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Error: EMAIL and PASSWORD must be set"
  echo "Run ./01_register_user.sh first, or set: EMAIL=test@example.com PASSWORD=TestPass123! ./02_login.sh"
  exit 1
fi

echo "==> Login"
echo "Email: $EMAIL"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

check_response "$RESPONSE"
format_json "$RESPONSE"

TOKEN=$(extract_json_value "$RESPONSE" "token")
USER_ID=$(extract_json_value "$RESPONSE" "user._id")

echo ""
if [ -n "$TOKEN" ]; then
  write_arg "token" "$TOKEN"
  write_arg "user_id" "$USER_ID"
  echo "✓ Token saved to arguments.json"
  echo ""
  echo "Next: ./04_create_venue.sh (organizer) or ./07_list_events.sh (customer)"
else
  echo "✗ Login failed - check credentials"
  exit 1
fi
