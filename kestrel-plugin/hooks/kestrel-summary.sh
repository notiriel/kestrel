#!/bin/bash
# Async hook: summarizes prompt/completion text and sends to Kestrel
# Runs in background — does not block Claude Code
# Only updates the message, never the status (status is set immediately by kestrel-status.sh)

# Prevent recursion from inner claude -p call
[ "$KESTREL_SUMMARIZING" = "1" ] && exit 0

LOG="/tmp/kestrel-hooks.log"
log() { echo "[$(date '+%H:%M:%S.%3N')] [summary] $*" >> "$LOG"; }

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id')
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name')

log "--- summary hook fired --- event=$EVENT session=$SESSION_ID"

case "$EVENT" in
    UserPromptSubmit)
        TEXT=$(echo "$INPUT" | jq -r '.prompt')
        SYSTEM_PROMPT="Summarize this task request in 2-4 words. Reply with ONLY the summary, nothing else."
        ;;
    Stop)
        TEXT=$(echo "$INPUT" | jq -r '.last_assistant_message')
        SYSTEM_PROMPT="Summarize the outcome in 2-4 words. Reply with ONLY the summary, nothing else."
        ;;
    *)
        log "Unknown event: $EVENT"
        exit 0
        ;;
esac

[ -z "$TEXT" ] || [ "$TEXT" = "null" ] && { log "No text to summarize"; exit 0; }

export KESTREL_SUMMARIZING=1
SUMMARY=$(env -u CLAUDECODE claude -p --model haiku "$SYSTEM_PROMPT: $TEXT" 2>/dev/null)
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
