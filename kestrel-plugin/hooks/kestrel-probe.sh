#!/bin/bash

# Prevent recursion from inner claude -p call
[ "$KESTREL_SUMMARIZING" = "1" ] && exit 0

LOG="/tmp/kestrel-hooks.log"
log() { echo "[$(date '+%H:%M:%S.%3N')] [probe] $*" >> "$LOG"; }

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
log "--- probe hook fired --- session=$SESSION_ID"
log "stdin: $INPUT"

# Find the terminal's pts device by walking up the parent process chain.
# Claude Code hooks run without a controlling terminal (/dev/tty unavailable),
# so we locate the pts from the nearest ancestor that has one.
PTS=""
pid=$$
while [ "$pid" -gt 1 ]; do
    tty=$(readlink /proc/$pid/fd/0 2>/dev/null)
    if [[ "$tty" == /dev/pts/* ]]; then
        PTS="$tty"
        break
    fi
    pid=$(awk '{print $4}' /proc/$pid/stat 2>/dev/null)
done

if [ -z "$PTS" ]; then
    log "ERROR: could not find pts device"
else
    log "found pts: $PTS"
    printf '\033]0;kestrel_probe_%s\033\\' "$SESSION_ID" > "$PTS"
    sleep 0.3
    printf '\033]0;Claude\033\\' > "$PTS"
fi

log "probe done"
