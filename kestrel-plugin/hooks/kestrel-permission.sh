#!/bin/bash
# Kestrel PermissionRequest hook handler
# Reads PermissionRequest JSON from stdin, sends to Kestrel overlay,
# waits for user response, outputs Claude Code decision JSON.

set -euo pipefail

LOG="/tmp/kestrel-hooks.log"
log() { echo "[$(date '+%H:%M:%S.%3N')] [permission] $*" >> "$LOG"; }

INPUT=$(cat)
log "--- permission hook fired ---"
log "stdin: $INPUT"

# Skip AskUserQuestion — let it fall through to the terminal UI
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""')
if [ "$TOOL_NAME" = "AskUserQuestion" ]; then
    log "skipping AskUserQuestion — not a real permission"
    exit 0
fi

# Skip ExitPlanMode — hook-based allow doesn't exit plan mode (upstream bug),
# and the terminal UI has the proper multi-choice widget. Fire a notification
# so the user knows even when the session isn't the focused window.
if [ "$TOOL_NAME" = "ExitPlanMode" ]; then
    log "skipping ExitPlanMode — sending notification and falling through to terminal UI"
    SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // ""')
    NOTIFY_PAYLOAD=$(jq -n -c --arg sid "$SESSION_ID" '{
        session_id: $sid,
        type: "notification",
        title: "Plan Mode",
        message: "Wants to exit plan mode",
    }')
    gdbus call --session --dest org.gnome.Shell \
        --object-path /io/kestrel/Extension \
        --method io.kestrel.Extension.HandleNotification \
        "$NOTIFY_PAYLOAD" >/dev/null 2>&1 || true
    exit 0
fi

# If screen is locked, fall through to terminal UI — user can't see the overlay
SCREEN_LOCKED=$(gdbus call --session --dest org.gnome.ScreenSaver \
    --object-path /org/gnome/ScreenSaver \
    --method org.gnome.ScreenSaver.GetActive 2>/dev/null || echo "(false,)")
if echo "$SCREEN_LOCKED" | grep -q "(true,)"; then
    log "screen is locked, falling through to terminal UI"
    jq -n '{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"ask"}}}'
    exit 0
fi

# Build payload for Kestrel
PAYLOAD=$(echo "$INPUT" | jq -c '{
    session_id: .session_id,
    type: "permission",
    title: ("Permission: " + (.tool_name // "Unknown")),
    message: (.tool_input.description // .tool_input.command // "Tool use requested"),
    command: (.tool_input.command // null),
    tool_name: (.tool_name // null),
}')

# Send to Kestrel via custom DBus interface, get notification ID
log "payload: $PAYLOAD"
RESULT=$(gdbus call --session --dest org.gnome.Shell \
    --object-path /io/kestrel/Extension \
    --method io.kestrel.Extension.HandlePermission \
    "$PAYLOAD" 2>&1)
log "dbus result: $RESULT"

# Extract notification ID from result — response looks like ('{"id":"notif-123"}',)
NOTIF_ID=$(echo "$RESULT" | grep -oP 'notif-[0-9a-f-]+')

if [ -z "$NOTIF_ID" ]; then
    # Fallback: allow if Kestrel is not available
    jq -n '{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"}}}'
    exit 0
fi

# Poll for user decision via DBus (up to 10 minutes)
for i in $(seq 1 1200); do
    POLL=$(gdbus call --session --dest org.gnome.Shell \
        --object-path /io/kestrel/Extension \
        --method io.kestrel.Extension.GetNotificationResponse \
        "$NOTIF_ID" 2>/dev/null || echo "")

    # Extract the JSON response string from DBus tuple ('{"action":"allow"}',)
    RESPONSE_JSON=$(echo "$POLL" | sed "s/^('//;s/',)$//")

    # Check if we got a non-pending response
    if echo "$RESPONSE_JSON" | jq -e '.action' >/dev/null 2>&1; then
        RESPONSE=$(echo "$RESPONSE_JSON" | jq -r '.action')
        break
    fi

    sleep 0.5
done

# Default to ask (re-prompt via terminal UI) if timeout
RESPONSE=${RESPONSE:-ask}

# Output decision JSON based on user's choice
case "$RESPONSE" in
    allow)
        jq -n '{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"}}}'
        ;;
    deny)
        jq -n '{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"deny",message:"Denied from Kestrel overlay"}}}'
        ;;
    always)
        # Allow + apply the first permission suggestion if available
        SUGGESTION=$(echo "$INPUT" | jq -c '.permission_suggestions[0] // empty' 2>/dev/null)
        if [ -n "$SUGGESTION" ]; then
            jq -n --argjson s "$SUGGESTION" \
                '{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow",updatedPermissions:[$s]}}}'
        else
            jq -n '{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"allow"}}}'
        fi
        ;;
    ask)
        jq -n '{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"ask"}}}'
        ;;
    *)
        jq -n '{hookSpecificOutput:{hookEventName:"PermissionRequest",decision:{behavior:"deny",message:"Unknown response from Kestrel"}}}'
        ;;
esac
