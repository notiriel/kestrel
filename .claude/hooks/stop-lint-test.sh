#!/bin/bash
set -euo pipefail

INPUT=$(cat)

# Prevent infinite loops — if we already blocked once, let the agent stop
STOP_HOOK_ACTIVE=$(echo "$INPUT" | jq -r '.stop_hook_active')
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
  exit 0
fi

PROJECT_DIR=$(echo "$INPUT" | jq -r '.cwd')
cd "$PROJECT_DIR"

FAILURES=""

# Run TypeScript compilation (type checking / linting)
TSC_OUTPUT=$(npx tsc 2>&1) || {
  FAILURES+="## TypeScript compilation errors\n\n\`\`\`\n${TSC_OUTPUT}\n\`\`\`\n\n"
}

# Run all tests
TEST_OUTPUT=$(npx vitest run 2>&1) || {
  FAILURES+="## Test failures\n\n\`\`\`\n${TEST_OUTPUT}\n\`\`\`\n\n"
}

if [ -n "$FAILURES" ]; then
  REASON="Your changes have lint/test violations. Fix them before finishing.\n\n${FAILURES}"
  jq -n --arg reason "$REASON" '{
    "decision": "block",
    "reason": $reason
  }'
else
  exit 0
fi
