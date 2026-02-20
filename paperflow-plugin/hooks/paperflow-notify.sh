#!/bin/bash
# PaperFlow Notification hook handler
# Reads notification JSON from stdin, shows a card in PaperFlow overlay.
# Fire-and-forget — idle notifications don't need a response back to Claude.

set -euo pipefail

LOG="/tmp/paperflow-hooks.log"
log() { echo "[$(date '+%H:%M:%S.%3N')] [notify] $*" >> "$LOG"; }

DEFAULT_MSG="${1:-}"

INPUT=$(cat)
log "--- notify hook fired --- default_msg=$DEFAULT_MSG"
log "stdin: $INPUT"

# Build payload for PaperFlow
PAYLOAD=$(echo "$INPUT" | jq -c --arg default_msg "$DEFAULT_MSG" '{
    session_id: .session_id,
    type: "notification",
    title: (.title // "Claude Code"),
    message: (if $default_msg != "" then $default_msg else (.message // "") end),
}')
log "payload: $PAYLOAD"

# Send to PaperFlow via custom DBus interface
RESULT=$(gdbus call --session --dest org.gnome.Shell \
    --object-path /io/paperflow/Extension \
    --method io.paperflow.Extension.HandleNotification \
    "$PAYLOAD" 2>&1) && log "dbus ok: $RESULT" || log "dbus error: $RESULT"
