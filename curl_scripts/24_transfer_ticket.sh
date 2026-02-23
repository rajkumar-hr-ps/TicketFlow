#!/bin/bash
# Transfer Ticket - Transfer a ticket to another user by email

source "$(dirname "$0")/common.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"

TOKEN="${TOKEN:-$(read_arg 'token' '')}"
TICKET_ID="${TICKET_ID:-$(read_arg 'ticket_id' '')}"
TO_EMAIL="${TO_EMAIL:-$(read_arg 'to_email' '')}"

if [ -z "$TOKEN" ]; then
  echo "Error: TOKEN must be set"
  echo "Run ./02_login.sh first"
  exit 1
fi

if [ -z "$TICKET_ID" ]; then
  echo "Error: TICKET_ID must be set"
  echo "Run ./19_get_order.sh first or edit arguments.json"
  exit 1
fi

if [ -z "$TO_EMAIL" ]; then
  echo "Error: TO_EMAIL must be set"
  echo "Set in arguments.json or pass: TO_EMAIL=recipient@example.com ./24_transfer_ticket.sh"
  exit 1
fi

echo "==> Transfer Ticket"
echo "Ticket: $TICKET_ID -> $TO_EMAIL"
echo ""

RESPONSE=$(curl -s -X POST "${BASE_URL}/api/v1/tickets/${TICKET_ID}/transfer" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TOKEN}" \
  -d "{\"to_email\":\"${TO_EMAIL}\"}")

check_response "$RESPONSE"
format_json "$RESPONSE"

echo ""
echo "Note: The recipient must be a registered user."
echo "The ticket's ownership transfers immediately — this cannot be undone."
echo ""
echo "Tip: Set the recipient:"
echo "  TO_EMAIL=friend@example.com ./24_transfer_ticket.sh"
