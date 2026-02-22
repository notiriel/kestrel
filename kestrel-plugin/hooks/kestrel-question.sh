#!/bin/bash
# Kestrel AskUserQuestion hook handler
# Intercepts AskUserQuestion via PreToolUse, routes to Kestrel overlay,
# collects answers, and returns them as updatedInput to Claude Code.
#
# Uses PreToolUse (not PermissionRequest) so it blocks even in bypassPermissions mode.

set -euo pipefail

LOG="/tmp/kestrel-hooks.log"
log() { echo "[$(date '+%H:%M:%S.%3N')] [question] $*" >> "$LOG"; }

INPUT=$(cat)
log "--- question hook fired ---"
log "stdin: $INPUT"

# If screen is locked, fall through to terminal UI — user can't see the overlay
SCREEN_LOCKED=$(gdbus call --session --dest org.gnome.ScreenSaver \
    --object-path /org/gnome/ScreenSaver \
    --method org.gnome.ScreenSaver.GetActive 2>/dev/null || echo "(false,)")
if echo "$SCREEN_LOCKED" | grep -q "(true,)"; then
    log "screen is locked, falling through to terminal UI"
    exit 0
fi

# Build payload for Kestrel — pass the full tool_input so the extension
# can extract questions
PAYLOAD=$(echo "$INPUT" | jq -c '{
    session_id: .session_id,
    type: "permission",
    title: "Question",
    message: "Session wants your input",
    tool_name: .tool_name,
    tool_input: .tool_input,
}')

# Send to Kestrel via custom DBus interface
log "payload: $PAYLOAD"
RESULT=$(gdbus call --session --dest org.gnome.Shell \
    --object-path /io/kestrel/Extension \
    --method io.kestrel.Extension.HandlePermission \
    "$PAYLOAD" 2>&1)
log "dbus result: $RESULT"

# Extract notification ID
NOTIF_ID=$(echo "$RESULT" | grep -oP 'notif-[0-9a-f-]+')

if [ -z "$NOTIF_ID" ]; then
    # Fallback: let the tool run normally (terminal UI takes over)
    log "no notif ID, falling through"
    exit 0
fi

# Poll for user decision (up to 10 minutes)
RESPONSE=""
for i in $(seq 1 1200); do
    POLL=$(gdbus call --session --dest org.gnome.Shell \
        --object-path /io/kestrel/Extension \
        --method io.kestrel.Extension.GetNotificationResponse \
        "$NOTIF_ID" 2>/dev/null || echo "")

    # Extract JSON from DBus tuple ('{"action":"allow","answers":{...}}',)
    RESPONSE_JSON=$(echo "$POLL" | sed "s/^('//;s/',)$//")

    # Check if we got a non-pending response
    if echo "$RESPONSE_JSON" | jq -e '.action' >/dev/null 2>&1; then
        RESPONSE=$(echo "$RESPONSE_JSON" | jq -r '.action')
        ANSWERS_RAW=$(echo "$RESPONSE_JSON" | jq -c '.answers // empty' 2>/dev/null)
        break
    fi

    sleep 0.5
done

# Default to allow (fall through to terminal UI) on timeout
RESPONSE=${RESPONSE:-allow}

log "response: $RESPONSE"
log "answers_raw: ${ANSWERS_RAW:-none}"

if [ "$RESPONSE" = "allow" ] && [ -n "${ANSWERS_RAW:-}" ]; then
    # We have answers — map question indices back to question text for updatedInput
    # The answers come as {"0":["Red"],"1":["Yes","No"]}
    # We need to map them to {"question text": "Red", "other question": "Yes;No"}

    # Extract questions array from original input
    QUESTIONS=$(echo "$INPUT" | jq -c '.tool_input.questions // []')

    # Build the answers object keyed by question text
    MAPPED_ANSWERS=$(echo "$ANSWERS_RAW" | jq -c --argjson questions "$QUESTIONS" '
        to_entries | reduce .[] as $entry (
            {};
            . + {
                ($questions[$entry.key | tonumber].question // ("question_" + $entry.key)):
                    (if ($entry.value | length) == 1
                     then $entry.value[0]
                     else ($entry.value | join(";"))
                     end)
            }
        )
    ')

    log "mapped_answers: $MAPPED_ANSWERS"

    # Return allow with updatedInput containing the answers
    # PreToolUse format: permissionDecision + updatedInput
    jq -n --argjson answers "$MAPPED_ANSWERS" '{
        hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            updatedInput: {
                answers: $answers
            }
        }
    }'
else
    # No answers (dismiss/visit/timeout) — let the tool run normally
    log "no answers, falling through"
    exit 0
fi
