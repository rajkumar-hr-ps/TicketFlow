#!/bin/bash
# Register User - Create a new user account

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

# Auto-generate unique email if not set
if [ -z "$EMAIL" ]; then
  if command -v python3 &> /dev/null; then
    MILLIS=$(python3 -c "import time; print(int(time.time() * 1000))")
  else
    MILLIS="$(date +%s)${RANDOM}"
  fi
  EMAIL="testuser_${MILLIS}_${RANDOM}@example.com"
fi

PASSWORD="${PASSWORD:-$(read_arg 'password' 'TestPass123!')}"
NAME="${NAME:-$(read_arg 'name' 'Test Organizer')}"
ROLE="${ROLE:-$(read_arg 'role' 'organizer')}"

echo "==> Register User"
echo "Name: $NAME | Email: $EMAIL | Role: $ROLE"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${NAME}\",\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"role\":\"${ROLE}\"}")

check_response "$RESPONSE"
format_json "$RESPONSE"
check_error "$RESPONSE" "Registration"

# Save to arguments.json
USER_ID=$(extract_json_value "$RESPONSE" "user._id")
TOKEN=$(extract_json_value "$RESPONSE" "token")

if [ -z "$USER_ID" ] || [ -z "$TOKEN" ]; then
  echo ""
  echo "✗ Registration failed - missing user ID or token in response"
  exit 1
fi

write_arg "email" "$EMAIL"
write_arg "password" "$PASSWORD"
write_arg "name" "$NAME"
write_arg "role" "$ROLE"
write_arg "user_id" "$USER_ID"
write_arg "token" "$TOKEN"

echo ""
echo "✓ Credentials saved to arguments.json"
echo "✓ You can now run: ./02_login.sh"
