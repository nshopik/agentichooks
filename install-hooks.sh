#!/usr/bin/env bash
# install-hooks.sh
# Idempotently installs Claude Code hooks that POST to a Stream Deck plugin
# running on a Windows host (over an SSH reverse tunnel by default).
#
# Run with:
#   bash install-hooks.sh                    # default: http://localhost:9123
#   CLAUDE_NOTIFY_URL=http://10.0.0.5:9123 bash install-hooks.sh
#
# The plugin's HTTP listener binds 127.0.0.1:9123 on the Windows side, so the
# typical setup is to forward it via:
#   ssh -R 9123:127.0.0.1:9123 user@windows-host

set -euo pipefail

URL="${CLAUDE_NOTIFY_URL:-http://localhost:9123}"
SETTINGS="${HOME}/.claude/settings.json"
MARKER="_claude-notify-installer"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (apt install jq / brew install jq)" >&2
  exit 1
fi

mkdir -p "$(dirname "$SETTINGS")"
if [[ ! -s "$SETTINGS" ]]; then
  echo '{}' > "$SETTINGS"
fi

# event_name -> path suffix on the listener
declare -a EVENTS=(
  # Alert-arming events
  "Stop:stop"
  "Notification:idle"
  "PermissionRequest:permission"
  "TaskCompleted:task-completed"
  # Full dismiss (clears every alert including task-completed)
  "StopFailure:active"
  "UserPromptSubmit:active"
  # Soft dismiss (clears all except sticky event types — task-completed survives)
  "PermissionDenied:active-soft"
  "PostToolUse:active-soft"
  "PostToolUseFailure:active-soft"
)

added=0
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cp "$SETTINGS" "$tmp"

for entry in "${EVENTS[@]}"; do
  evt="${entry%%:*}"
  suffix="${entry##*:}"
  cmd="curl -fsS -m 2 -X POST ${URL}/event/${suffix} >/dev/null 2>&1 || true"

  # Detect existing installer-tagged hook for this event.
  has_ours=$(jq --arg evt "$evt" --arg marker "$MARKER" '
    (.hooks[$evt] // [])
    | map(.hooks // [])
    | flatten
    | map(select(has($marker)))
    | length > 0
  ' "$tmp")

  if [[ "$has_ours" == "true" ]]; then
    echo "[skip] $evt already has Claude Notify hook"
    continue
  fi

  jq --arg evt "$evt" \
     --arg cmd "$cmd" \
     --arg marker "$MARKER" '
    .hooks //= {}
    | .hooks[$evt] //= []
    | .hooks[$evt] += [{
        hooks: [{
          type: "command",
          command: $cmd,
          ($marker): "v1"
        }]
      }]
  ' "$tmp" > "${tmp}.new"
  mv "${tmp}.new" "$tmp"

  echo "[add ] $evt -> POST ${URL}/event/${suffix}"
  added=$((added + 1))
done

if [[ "$added" -gt 0 ]]; then
  mv "$tmp" "$SETTINGS"
  trap - EXIT
  echo
  echo "Done. Wrote $SETTINGS"
  echo "Test it: curl -X POST ${URL}/event/stop"
else
  echo
  echo "No changes needed."
fi
