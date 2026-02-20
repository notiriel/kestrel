#!/bin/bash
# Usage: paperflow-status.sh <status>
# Reads session_id from stdin JSON, sets window status via DBus

LOG="/tmp/paperflow-hooks.log"
log() { echo "[$(date '+%H:%M:%S.%3N')] [status] $*" >> "$LOG"; }

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
log "--- status hook fired --- status=$1 session=$SESSION_ID"
log "stdin: $INPUT"

RESULT=$(gdbus call --session --dest org.gnome.Shell \
  --object-path /io/paperflow/Extension \
  --method io.paperflow.Extension.SetWindowStatus \
  "$SESSION_ID" "$1" 2>&1) && log "dbus ok: $RESULT" || log "dbus error: $RESULT"
