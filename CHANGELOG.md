# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- **Subagent pill with no in-flight tasks** — the Task-Completed key only
  rendered when the task count was > 0, so a lone subagent (a `subagent-start`
  without a matching `task-created`, e.g. partial hook coverage on older Claude
  Code) never showed its coral pill. Both render paths now paint whenever there
  is a task **or** a subagent; with zero tasks the center shows a big `0`
  alongside the pill. (#48)

## [0.9.3] - 2026-06-07

### Removed

- **Test flash button** — the debug-only Property Inspector button (and its
  `test-flash` `sendToPlugin` handler) that pulsed the key without a real hook
  event. Also dropped the outdated `curl …` trigger-command tip from the
  Property Inspector, which no longer reflected the installed hook wiring. (#47)
- **Trigger Hook action** — the debug-only fourth button that POSTed hook routes
  on key press. The manual curl playbook covers the same need without shipping a
  debug surface; removal also pre-empts special-casing its synthetic
  `session_id: "streamdeck-trigger"` in the upcoming session-scoped alert
  clearing. Keys still assigned to it will show a missing-action placeholder
  after update. (#43)

### Added

- Stop/Permission keys show the arming session's repository basename as the key title while armed, with a `+N` second line when more sessions are armed (latest-wins). User-set key titles always win — the plugin title is ignored on keys with a custom title. (#44)
- **Elapsed turn time on the On Stop button** — a live timer starts on
  `UserPromptSubmit` and ends on `Stop`/`StopFailure`, rendered as the centerpiece
  of the thinking visual: big gray time centered on the key, coral sparkle pulse
  tucked into the top-left corner. Format tiers: `35s` (< 60 s) → `4:37` (< 1 h) →
  `1:04:52` (< 10 h, smaller font) → `10:04` (≥ 10 h, seconds dropped). With
  multiple sessions thinking, the latest prompt's timer is shown, falling back to
  the previous still-running session when it stops. New pure modules
  `format-elapsed.ts` and `turn-clock.ts` (a decorator over the thinking counter
  slot — dispatcher, route matrix, and `SessionSetCounter` untouched). (#40)

### Changed

- The per-button "Animate thinking" checkbox now gates **only the corner sparkle**
  (PI label reworded to "Animate thinking sparkle"); the elapsed timer renders on
  every On Stop key whenever a turn is running. The armed alert still wins
  visually — the timer paints the idle state underneath. (#40)

### Fixed

- The On Stop thinking-repaint interval no longer ticks while no On Stop key is
  visible (e.g. after a page switch mid-turn): it stops when the last key
  context disappears and restarts when one reappears. Previously it fired every
  200 ms over an empty context map — harmless but wasteful. (#46)
- Elapsed turn timer no longer shows stale idle time after an Esc-cancelled
  turn: `Stop` hooks don't fire on user interrupts, so the resubmitted prompt's
  `UserPromptSubmit` arrived for an already-tracked session and kept the old
  start timestamp. A duplicate prompt now refreshes the timestamp (a queued
  prompt mid-turn restarts the timer — accepted trade-off) while still never
  stealing the display from a newer session. (#45)
- Session-scoped alert clearing: a clearing hook from one Claude Code session (e.g. `post-tool-use`, `session-end`, `user-prompt-submit`) no longer dismisses armed alerts raised by another session. Pending/armed alert state is tracked per session; keypress and per-button auto-timeout still dismiss all sessions for that key's type. (#44)
- `install-hooks.ps1` no longer crashes on a bare-filename `-SettingsPath`
  (e.g. `settings.json`): the path is normalized to an absolute path against
  the shell's current directory before use. The test suite also gains an
  explicit BOM-absence assertion (raw-byte check) so the PR #34 BOM fix can't
  silently regress. (#36)
- `install-hooks.sh` now creates its temp files next to the target
  `settings.json` instead of in the system temp dir, making the final rename
  atomic even when `~/.claude` lives on a different mount than `/tmp`. (#36)

### Changed

- `SubagentStart` and `SubagentStop` hooks are now processed as action routes (14 action
  + 15 info = 29 total) instead of log-only, so the subagent pill updates in real time.
  The installer entry count is unchanged. (#38)
- Manual curl recipes for `task-created`/`task-completed` now require a `task_id` field;
  `subagent-start`/`subagent-stop` recipes require `agent_id`. Bare bodies are dropped
  with a WARN log. (#38)
- Trigger Hook action now sends synthetic `task_id`/`agent_id` (`streamdeck-trigger`) on
  the four id-gated routes so manual key presses still fire them. (#38)
- Trigger Hook tooltip reworded to "Send a Claude Code hook event on key
  press" (drops the implementation verb). (#36)

### Added

- **Dual-metric badge on Task Completed button** — the big yellow number now tracks
  in-flight *task* count (based on `TaskCreated`/`TaskCompleted` event ids); a coral
  notification pill in the top-right corner shows the running subagent count (fed by
  `SubagentStart`/`SubagentStop`). Both metrics use per-session id-sets, eliminating
  drift from duplicate or orphan events. (#38)
- **On Stop thinking indicator** — animated coral glyph (8-frame pulse) while any
  session is thinking (`UserPromptSubmit` → `Stop`). On by default; disable per button
  via the "Animate while Claude is thinking" checkbox in the On Stop Property
  Inspector. (#38, #39)
- **Trigger Hook action** — a fourth Stream Deck button that POSTs to a
  configurable `http://127.0.0.1:9123/event/<route>` on key press, using the
  same HTTP transport as real Claude Code hooks. Useful for manual alert
  replays and Stream Deck multi-actions. Select the target route in the
  Property Inspector; the key shows a tick on success or an alert cross on
  failure (e.g. listener not running). (#35)

### Security

- Warn-line logging in the HTTP listener is no longer attacker-amplifiable:
  attacker-controlled values (`Origin`/`Host` headers, request URL,
  notification message) are truncated to 120 chars with an explicit
  `…(+N more)` marker, and warn diagnostics are rate-limited to 10 per
  60-second window (one suppression notice marks the cut). Normal result
  log lines are unaffected. (#30)
- The HTTP listener now destroys connections that stay idle for 5 seconds
  (no data flowing in either direction). Previously a peer reached over an SSH
  remote forward could hold sockets open indefinitely (slowloris); the 64 KB
  body cap bounded memory but not connection lifetime. Normal Claude Code
  hooks (2-second client timeout) are unaffected. (#28)

### Breaking

- `animateCounter` per-button setting removed; any stored value is silently ignored on
  next load. Replace with `animateThinking` on the On Stop button if desired. (#38)
- Action-route POSTs without a `session_id` body field are now dropped with a warn
  log and produce no alert, sound, or state change. Affected callers:
  - **Bare `curl.exe -X POST …/event/stop`** (no body) — now a no-op. Add
    `-H "Content-Type: application/json" -d '{"session_id":"manual-test"}'` for
    manual testing.
  - **v1 curl-based hooks** (shell wrappers that posted empty bodies). The
    `install-hooks.ps1` / `install-hooks.sh` installers have auto-replaced v1 marker
    entries with native `type:"http"` hooks since the v2 marker — any remaining v1
    hooks must be re-run through the installer to migrate.
  - Native Claude Code `type:"http"` hooks always include `session_id` in the event
    JSON — real hooks are unaffected. (#27)

### Fixed

- `install-hooks.ps1` now writes `settings.json` atomically via a temp file in
  the same directory followed by `Move-Item -Force`, eliminating the corruption
  window between `Set-Content`'s truncate and write phases. `ConvertTo-Json
  -Depth` is raised from 10 to 100, preventing silent data loss for settings
  nested deeper than 10 levels. The file is now written as UTF-8 **without
  BOM** (`Set-Content -Encoding UTF8` wrote a BOM under Windows PowerShell
  5.1). `install-hooks.sh` was verified to already write atomically via
  temp-file-then-rename. Both installers gained a settings-path override
  (`-SettingsPath` / `SETTINGS_PATH`) and vitest suites that exercise the real
  scripts against temp directories. (#34)
- A garbage `flashMode` value arriving from the Property Inspector (anything
  but `"static"`/`"pulse"`) now collapses to the default instead of flowing
  through typed as valid and silently breaking pulse handling. (#31)
- Rapid arm→clear→arm cycling (e.g. alternating `permission-request`/
  `permission-denied`) no longer spawns overlapping sound processes — the
  audio player now skips `play()` while a previous sound is still playing
  and re-arms when that process exits. (#29)
- Warn logs for empty/unparseable/oversize POST bodies on info-only routes
  (e.g. `/event/notification`) no longer carry the misleading
  `(session_id required)` suffix — info routes are never session-gated; they
  now log `(no usable body)` instead. Action routes keep the original
  suffix. (#28)
- Dismissing an alert (pressing the lit button, or the per-button auto-timeout
  expiring) now clears the alert for the whole event type — previously only the
  visible button was cleared, so a dismissed alert came back after a page or
  profile switch (indefinitely for Stop/Permission, which have no default
  timeout), a same-type button on another page could resurrect it, and the next
  alert of that type fired instantly instead of honoring its alert delay.
  Pressing one lit button now also clears same-type buttons on other pages (#25)
- The in-flight task count badge no longer reappears frozen on a Task Completed
  button that was on a hidden page when the count reached zero — the button now
  clears the stale badge when it comes back into view (#25)
- `SessionStart` from auto-compaction (`source: "compact"`) or `--resume`/`/resume`
  (`source: "resume"`) no longer clears alerts or resets the in-flight task
  counter — previously a mid-run compaction silently zeroed the count and the
  task-completed alert never fired. The hook body's `source` field now routes
  those two cases to a synthetic no-op matrix row (`/event/session-start-soft`);
  `startup`, `clear`, and bodyless manual POSTs keep the full clear-all + reset
  behavior. `[http]` result lines now include `source=<value>` when present (#23)
- Hook events from agent contexts (in-process subagents, teammates, `--agent`
  runs — any body carrying `agent_id`) no longer arm stop or permission alerts,
  clear armed alerts, or reset the in-flight task counter — previously a
  subagent's tool calls silently dismissed legitimate alerts and teammate
  lifecycles armed ghost ones. Agent-context `task-created` still increments
  the shared counter; agent-context `task-completed` decrements via a synthetic
  counter-only matrix row (`/event/task-completed-agent`) that deliberately
  skips the normal row's permission-clear, so team workflows still reach zero
  and fire the task-completed alert. `[http]` result lines now include
  `agent=<8-char id>` when present (#24)
- Task counter is now keyed by `session_id` so concurrent Claude Code sessions
  each drive their own in-flight count bucket. The "all tasks done" chime fires
  when a *session's* count reaches zero (per-session chime), not when the global
  sum across all sessions hits zero. The badge on the Stream Deck button continues
  to show the total in-flight count across all sessions. (#37)

## [0.9.2] - 2026-05-11

### Added

- `parseHookBody` module (`src/parse-hook-body.ts`) — pure chunk buffer with a `BodyOutcome`
  discriminated union (`empty` / `unparseable` / `oversize` / `parsed`) for
  clean caller branching without re-inspection
- `session_id` (truncated to 8 chars) and `cwd` (basename only) now appear in
  every `[http]` result log line: `session=<8char> cwd=<basename>` for parsed
  bodies, `session=? cwd=?` when the body is absent or malformed
- `[http]` INFO line for `/event/notification` `message` field when present,
  e.g. `notification message="Claude Code needs your attention"`
- WARN-level diagnostics for empty, unparseable, and oversize POST bodies on
  any route — fires regardless of route classification so misconfigured
  installers are immediately visible in the log

- Animated Claude-spinner corner glyph on the in-flight Task Completed icon —
  coral spinner cycling at 5 fps over a yellow count on black. New
  `animateCounter` global setting (default on) with a Property Inspector
  toggle that swaps the spinner for a static yellow sparkle when disabled (#7)

### Changed

- Logging refactor: per-module scoped loggers (`[http]`, `[dispatch]`,
  `[audio]`, `[counter]`) via the SDK's `createScope()`, with `debug` and
  `trace` levels added throughout. `AGENTIC_HOOKS_DEBUG=1` now raises the log
  level to `debug` (previously bumped `warn` → `info`); `AGENTIC_HOOKS_DEBUG=trace`
  enables the per-route state-dump trace line. Default level is `info` (#8)
- Stream Deck SDK alignment audit follow-up — paired `showAlert()` with a
  diagnostic log line, declared `Controllers`, `SupportURL`, and `$schema` in
  `manifest.json`, opted into `useExperimentalMessageIdentifiers`. Set
  `UserTitleEnabled: false` on the Task Completed action: any custom title
  previously set on a Task Completed button will be silently hidden by the
  count-icon SVG that fills the button face (the title was already visually
  occluded; this just stops Stream Deck from rendering it underneath) (#10)
- `animateCounter` converted from a global setting to a per-action setting on
  the Task Completed button. Existing `animateCounter: false` in global settings
  is silently dropped on upgrade — affected users see animation re-enable and
  must re-toggle once per Task Completed button. Fixes the ~500 ms
  checked→unchecked PI checkbox flicker that occurred because the global
  settings fetch is async. Each Task Completed button now independently controls
  its own animation. (#13)
- Idle key PNG backgrounds changed from slate-800 (`#1f2937`) to pure black (`#000000`) — eliminates the visible hue shift when the in-flight count icon (which already used `#000000`) drains back to the idle manifest PNG
- In-flight count digit color changed from Tailwind yellow-400 (`#facc15`) to yellow-300 (`#fde047`) — brighter at desk distance without losing the muted-modern palette
- Corner sparkle (static polygon and animated Unicode glyph) scaled to 150% of original size, anchored at center (22, 22) — makes the star a clear sibling of the digit rather than incidental decoration

### Security

- SHA-pin all GitHub Actions to immutable commits (#16)
- reject cross-origin and non-loopback Host requests in HttpListener (#17)
- upgrade vitest 2.x → 4.x to clear dev-only CVEs (#18)

### Fixed

- Dev-mode log-level detection: replace the broken `NODE_ENV !== "development"`
  conditional in `src/plugin.ts` (which checked a signal nobody sets) with
  `--inspect*` execArgv detection mirroring the SDK's own `isDebugMode()`.
  Empirically verified that `npx streamdeck dev` provides no runtime signal to
  the plugin process — it only enables Property Inspector inspection — so the
  dev branch is dormant under normal Stream Deck launches but fires correctly
  when the plugin is launched via `node --inspect=...`. Production behavior
  (`AGENTIC_HOOKS_DEBUG=1` → `debug`, `=trace` → `trace`) is unchanged. Logic
  extracted into a tested pure module `src/log-level.ts` (#12)

## 0.9.1 — 2026-05-10

### Added

- Three per-event actions: On Stop, On Permission, On Task Completed (#3)
- Live in-flight subagent counter on the Task Completed button (#4)
- Listener routes for all 14 missing Claude Code hook events (#5)

### Changed

- Hook installer now writes Claude Code's native `type:"http"` entries
  instead of curl/PowerShell wrappers (#6)

### Fixed

- Task Completed Property Inspector displayed `0` for auto-dismiss when the
  code default was actually `30` seconds. The field now shows the real
  per-event default.

## 0.9.0 — 2026-05-09 — first public beta release

- first public release

### Notes

- macOS support is **experimental**. Windows is the tested install path; macOS
  code paths (afplay, system sounds, hook installer) compile and are wired up
  but have not been validated end-to-end on a real Mac. Reports welcome.
