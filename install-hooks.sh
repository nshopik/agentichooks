#!/usr/bin/env bash
# install-hooks.sh
# Idempotently installs Claude Code hooks that POST to a Stream Deck plugin
# via native type:"http" entries (no curl, no shell wrapper).
#
# Run with:
#   bash install-hooks.sh                     # default: http://127.0.0.1:9123
#   AGENTIC_HOOKS_URL=http://10.0.0.5:9123 bash install-hooks.sh
#
# The plugin's HTTP listener binds 127.0.0.1:9123 on the Windows side, so the
# typical remote-host setup is to forward it via:
#   ssh -R 9123:127.0.0.1:9123 user@windows-host
# and then run this installer on the remote host with the default URL.

set -euo pipefail

URL="${AGENTIC_HOOKS_URL:-http://127.0.0.1:9123}"
SETTINGS="${HOME}/.claude/settings.json"
MARKER="_agentic-hooks-installer"
CURRENT_VERSION="v2"

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (apt install jq / brew install jq)" >&2
  exit 1
fi

mkdir -p "$(dirname "$SETTINGS")"
if [[ ! -s "$SETTINGS" ]]; then
  echo '{}' > "$SETTINGS"
fi

# event_name -> path suffix on the listener.
# Mirrors install-hooks.ps1 exactly (11 action events + 18 info events = 29).
declare -a EVENTS=(
  # Action events (11)
  "Stop:stop"
  "StopFailure:stop-failure"
  "PermissionRequest:permission-request"
  "TaskCompleted:task-completed"
  "SessionStart:session-start"
  "SessionEnd:session-end"
  "UserPromptSubmit:user-prompt-submit"
  "PermissionDenied:permission-denied"
  "PostToolUse:post-tool-use"
  "PostToolUseFailure:post-tool-use-failure"
  "PreToolUse:pre-tool-use"
  # Info events (18)
  "Notification:notification"
  "PostToolBatch:post-tool-batch"
  "SubagentStart:subagent-start"
  "SubagentStop:subagent-stop"
  "TaskCreated:task-created"
  "Setup:setup"
  "InstructionsLoaded:instructions-loaded"
  "UserPromptExpansion:user-prompt-expansion"
  "TeammateIdle:teammate-idle"
  "ConfigChange:config-change"
  "CwdChanged:cwd-changed"
  "FileChanged:file-changed"
  "WorktreeCreate:worktree-create"
  "WorktreeRemove:worktree-remove"
  "PreCompact:pre-compact"
  "PostCompact:post-compact"
  "Elicitation:elicitation"
  "ElicitationResult:elicitation-result"
)

# Empty list — kept as a forward hook for orphan cleanup, mirroring the
# PowerShell installer. Add event names here when this installer drops them.
declare -a DROPPED_EVENTS=()

changed=0
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cp "$SETTINGS" "$tmp"

# Find the marker version of any existing Agentic Hooks hook for this event,
# or empty string if none.
find_our_hook_version() {
  local evt="$1"
  jq -r --arg evt "$evt" --arg marker "$MARKER" '
    (.hooks[$evt] // [])
    | map(.hooks // [])
    | flatten
    | map(select(has($marker)))
    | if length == 0 then "" else .[0][$marker] end
  ' "$tmp"
}

# Strip every Agentic Hooks hook entry from the named event. User-added hooks
# under the same event key are left in place. Empty entry containers are
# removed entirely so the array doesn't bloat.
remove_our_hooks() {
  local evt="$1"
  jq --arg evt "$evt" --arg marker "$MARKER" '
    .hooks[$evt] = (
      (.hooks[$evt] // [])
      | map(.hooks |= map(select(has($marker) | not)))
      | map(select((.hooks // []) | length > 0))
    )
  ' "$tmp" > "${tmp}.new" && mv "${tmp}.new" "$tmp"
}

# Append a single Agentic Hooks hook entry for the named event.
add_our_hook() {
  local evt="$1"
  local suffix="$2"
  jq --arg evt "$evt" \
     --arg url "$URL/event/$suffix" \
     --arg marker "$MARKER" \
     --arg version "$CURRENT_VERSION" '
    .hooks //= {}
    | .hooks[$evt] //= []
    | .hooks[$evt] += [{
        hooks: [{
          type: "http",
          url: $url,
          timeout: 2,
          ($marker): $version
        }]
      }]
  ' "$tmp" > "${tmp}.new" && mv "${tmp}.new" "$tmp"
}

for entry in "${EVENTS[@]}"; do
  evt="${entry%%:*}"
  suffix="${entry##*:}"

  existing_ver="$(find_our_hook_version "$evt")"

  if [[ "$existing_ver" == "$CURRENT_VERSION" ]]; then
    echo "[skip] $evt already at $CURRENT_VERSION"
    continue
  fi

  if [[ -n "$existing_ver" ]]; then
    remove_our_hooks "$evt"
    echo "[up  ] ${evt}: $existing_ver -> $CURRENT_VERSION"
  else
    echo "[add ] $evt -> POST $URL/event/$suffix"
  fi

  add_our_hook "$evt" "$suffix"
  changed=$((changed + 1))
done

# Orphan cleanup: drop our managed hooks from event keys we no longer install.
for evt in "${DROPPED_EVENTS[@]:-}"; do
  [[ -z "${evt:-}" ]] && continue
  existing_ver="$(find_our_hook_version "$evt")"
  if [[ -z "$existing_ver" ]]; then continue; fi
  remove_our_hooks "$evt"
  echo "[drop] removed managed $evt hook ($existing_ver; event no longer used)"
  changed=$((changed + 1))
done

if [[ "$changed" -gt 0 ]]; then
  mv "$tmp" "$SETTINGS"
  trap - EXIT
  echo
  echo "Done. Wrote $SETTINGS"
else
  echo
  echo "No changes needed."
fi

echo "Each hook fires a native type:\"http\" POST to $URL/event/<route>."
