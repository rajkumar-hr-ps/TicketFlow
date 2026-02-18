#!/bin/bash
# Common functions for curl scripts

ARGS_FILE="$(dirname "$0")/arguments.json"

# Read value from arguments.json
read_arg() {
  local key=$1
  local default=$2

  if [ ! -f "$ARGS_FILE" ]; then
    echo "$default"
    return
  fi

  local value=$(jq -r ".$key // empty" "$ARGS_FILE" 2>/dev/null)
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    echo "$default"
  else
    echo "$value"
  fi
}

# Write value to arguments.json
write_arg() {
  local key=$1
  local value=$2

  if [ ! -f "$ARGS_FILE" ]; then
    echo "{}" > "$ARGS_FILE"
  fi

  local temp_file=$(mktemp)
  jq --arg key "$key" --arg val "$value" '.[$key] = $val' "$ARGS_FILE" > "$temp_file" && mv "$temp_file" "$ARGS_FILE"
}

# Extract value from JSON response
extract_json_value() {
  local json=$1
  local key=$2
  echo "$json" | jq -r ".$key // empty" 2>/dev/null
}

# Format JSON output (use jq or python3 -m json.tool as fallback)
format_json() {
  local json=$1
  if command -v jq &> /dev/null; then
    echo "$json" | jq .
  elif command -v python3 &> /dev/null; then
    echo "$json" | python3 -m json.tool
  else
    echo "$json"
  fi
}

# Check for connection error
check_response() {
  local response=$1
  if [ -z "$response" ]; then
    echo "Error: Cannot connect to server"
    echo "Make sure server is running: npm start"
    exit 1
  fi
}

# Check for API error in response
check_error() {
  local response=$1
  local action=$2
  local error=$(extract_json_value "$response" "error")
  if [ -n "$error" ]; then
    echo ""
    echo "✗ ${action} failed: $error"
    exit 1
  fi
}
