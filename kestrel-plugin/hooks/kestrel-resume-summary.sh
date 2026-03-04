#!/bin/bash
# Async hook: on resume, summarize last user+agent messages for status badge
# Runs in background — does not block Claude Code

# Prevent recursion from inner claude -p call
[ "$KESTREL_SUMMARIZING" = "1" ] && exit 0

LOG="/tmp/kestrel-hooks.log"
log() { echo "[$(date '+%H:%M:%S.%3N')] [resume-summary] $*" >> "$LOG"; }

INPUT=$(cat)
SOURCE=$(echo "$INPUT" | jq -r '.source')
log "--- resume-summary hook fired --- source=$SOURCE"

[ "$SOURCE" != "resume" ] && { log "Not a resume (source=$SOURCE), skipping"; exit 0; }

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path')
log "session=$SESSION_ID transcript=$TRANSCRIPT"

[ -z "$TRANSCRIPT" ] || [ "$TRANSCRIPT" = "null" ] || [ ! -f "$TRANSCRIPT" ] && { log "No transcript file"; exit 0; }

# Extract last user message and last assistant message from JSONL
LAST_USER=$(tac "$TRANSCRIPT" | while IFS= read -r line; do
  type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
  [ "$type" = "user" ] && { echo "$line" | jq -r '.message.content // empty' 2>/dev/null; break; }
done)

LAST_ASSISTANT=$(tac "$TRANSCRIPT" | while IFS= read -r line; do
  type=$(echo "$line" | jq -r '.type // empty' 2>/dev/null)
  [ "$type" = "assistant" ] && { echo "$line" | jq -r '
    [.message.content[]? | select(.type == "text") | .text] | join(" ")
  ' 2>/dev/null; break; }
done)

# Truncate to ~500 chars each to keep Haiku prompt small
LAST_USER="${LAST_USER:0:500}"
LAST_ASSISTANT="${LAST_ASSISTANT:0:500}"

log "last_user=${#LAST_USER} chars, last_assistant=${#LAST_ASSISTANT} chars"
[ -z "$LAST_USER" ] && [ -z "$LAST_ASSISTANT" ] && { log "No messages found"; exit 0; }

export KESTREL_SUMMARIZING=1
SUMMARY=$(env -u CLAUDECODE claude -p --model haiku \
  "A Claude Code session was just resumed. Summarize the state in 3-6 words (what was being worked on and where it left off). Reply with ONLY the summary.

Last user request: $LAST_USER

Last agent response: $LAST_ASSISTANT" 2>/dev/null)
EXIT_CODE=$?
log "claude -p exit=$EXIT_CODE summary='$SUMMARY'"

if [ $EXIT_CODE -eq 0 ] && [ -n "$SUMMARY" ]; then
  # Empty status "" — only update the message, don't touch current status
  RESULT=$(gdbus call --session --dest org.gnome.Shell \
    --object-path /io/kestrel/Extension \
    --method io.kestrel.Extension.SetWindowStatus \
    "$SESSION_ID" "" "$SUMMARY" 2>&1) && log "dbus ok: $RESULT" || log "dbus error: $RESULT"
else
  log "No summary produced — skipping DBus call"
fi
