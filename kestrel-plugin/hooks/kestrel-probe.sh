#!/bin/bash

LOG="/tmp/kestrel-hooks.log"
log() { echo "[$(date '+%H:%M:%S.%3N')] [probe] $*" >> "$LOG"; }

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
log "--- probe hook fired --- session=$SESSION_ID"
log "stdin: $INPUT"

printf '\033]0;kestrel_probe_%s\033\\' "$SESSION_ID" > /dev/tty
sleep 0.3
printf '\033]0;Claude\033\\' > /dev/tty
log "probe done"
