# Stream Deck plugin for Claude Code notifications — Design

**Date**: 2026-05-08
**Status**: Draft, pending implementation plan
**Owner**: Nikolay Shopik

## Goal

A Stream Deck plugin that flashes a button — with an optional audio cue — with a distinct icon for each typical Claude Code notification event, regardless of whether Claude is running locally on Windows or on a remote machine reached over SSH. One configurable action that the user places one-or-many times on the deck; each placed button is bound to a single Claude hook event (Stop, Notification, or PermissionRequest) and shows a clear visual alert until dismissed. Audio feedback is primarily aimed at remote sessions, where Claude's own PowerShell sound hooks would otherwise be heard only on the remote machine.

Replaces the previous `com.nshopik.claudenotify.sdPlugin` attempt, which only handled a single "task done" signal from a local source and accumulated single-instance / context-tracking issues from being written against the raw Stream Deck WebSocket protocol.

## Non-goals

- Surfacing Claude events that aren't already wired as hooks (e.g. PreToolUse, SessionStart). Scope is limited to the three events the user actively cares about.
- Distinguishing **which** remote host fired an event. A button alerts on event type; the deck does not show or filter by host. (Adding per-host buttons is captured under "Out of scope".)
- Custom sounds or toast messages — those remain in the Claude hooks layer (existing PowerShell commands in local `settings.json`, equivalent shell snippets on remotes).
- macOS/Linux Stream Deck plugin support. The Stream Deck **plugin** is Windows-only, matching the user's machine. Remote *hooks* are POSIX shell so they work on the Linux/macOS boxes the user SSHes into.

## Events covered

| Event | Claude hook | Local sig file | Remote HTTP route |
| --- | --- | --- | --- |
| Stop (task complete) | `Stop` | `%TEMP%\claude-notify-stop.sig` | `POST /event/stop` |
| Idle / waiting | `Notification` | `%TEMP%\claude-notify-idle.sig` | `POST /event/idle` |
| Permission request | `PermissionRequest` | `%TEMP%\claude-notify-permission.sig` | `POST /event/permission` |

Each local hook is a one-line PowerShell command that writes a fresh ISO timestamp into its sig file. Each remote hook is a one-line `curl` that POSTs to `http://localhost:9123` over an SSH reverse tunnel. Both paths normalize into the same internal `EventType` and feed the same dispatcher.

## Architecture

```
                    ┌─ LOCAL (Windows, where Stream Deck lives) ─┐
                    │                                             │
                    │  Claude Code hooks (PowerShell)             │
                    │            │                                │
                    │            ▼ writes                         │
                    │  %TEMP%\claude-notify-{stop|idle|permission}.sig
                    │            │                                │
                    │            │ fs.watch                       │
                    │            ▼                                │
                    │  ┌────────────────────────────────────┐     │
                    │  │  Stream Deck plugin                │     │
                    │  │  com.nshopik.claudenotify          │     │
                    │  │  (Node.js / TypeScript on          │     │
                    │  │   @elgato/streamdeck SDK)          │     │
                    │  │                                    │     │
                    │  │  ┌─────────────────────────────┐   │     │
                    │  │  │ HTTP listener 127.0.0.1:9123│ ◀─┼─────┼──┐
                    │  │  └─────────────────────────────┘   │     │  │
                    │  │            │                       │     │  │ SSH reverse tunnel
                    │  │            ▼                       │     │  │ -R 9123:localhost:9123
                    │  │  Event dispatcher → buttons + audio│     │  │
                    │  └────────────────────────────────────┘     │  │
                    │            │ WebSocket (SDK-managed)        │  │
                    │            ▼                                │  │
                    │  Stream Deck buttons flash                  │  │
                    │              +                              │  │
                    │  Audio cue (PowerShell SoundPlayer, async)  │  │
                    └─────────────────────────────────────────────┘  │
                                                                     │
                    ┌─ REMOTE (Linux/macOS, where Claude runs) ──┐   │
                    │                                             │   │
                    │  Claude Code hooks (bash)                   │   │
                    │            │                                │   │
                    │            ▼ POST                           │   │
                    │  curl http://localhost:9123/event/{type} ───┼───┘
                    │   (only reachable via the reverse tunnel)   │
                    └─────────────────────────────────────────────┘
```

Two ingest paths, one dispatcher. Local uses sig files; remote uses HTTP over an SSH reverse tunnel. Both produce a normalized `EventType` and fan out to button instances configured for that type.

### Local signal mechanism: per-event sig files

One file per event type. Hooks `Set-Content` an ISO timestamp into the matching file; the plugin watches all three. Why this over alternatives:

- **vs single JSON file with event-type field**: per-file isolates back-to-back events. If Stop fires while a Permission alert is unread, neither overwrites the other.
- **vs HTTP-only (also for local)**: file-based hooks survive a stopped plugin (the next plugin start sees the most recent timestamp via mtime). They also have zero startup ordering between hook and plugin. The HTTP path is added because *remote* needs it, not because local does.

### Remote signal mechanism: HTTP over SSH reverse tunnel

Plugin opens a tiny HTTP server bound to `127.0.0.1:9123`. Three routes:

- `POST /event/stop`
- `POST /event/idle`
- `POST /event/permission`
- `GET /health` → `200 OK` (for the user to verify the tunnel is up)

Each hook on the remote side does:

```bash
curl -s --max-time 1 -X POST http://localhost:9123/event/stop >/dev/null 2>&1 &
```

The `--max-time 1` keeps Claude unblocked if the tunnel is down (e.g. SSH disconnected). The `&` makes it non-blocking. The plugin responds `204 No Content` immediately and dispatches the alert asynchronously.

The reverse tunnel is established by the user's SSH config:

```
Host my-dev-vm
  RemoteForward 9123 localhost:9123
```

Or ad-hoc: `ssh -R 9123:localhost:9123 my-dev-vm`. Multiple concurrent SSH sessions to different remotes each have their own `localhost:9123` listener on their respective remote hosts; all funnel back to the single local plugin.

### Why no auth

Listener binds `127.0.0.1` only — never `0.0.0.0`. The only network path from a remote into the listener is the SSH reverse tunnel itself, which is already authenticated by SSH. On the remote box, only processes that can reach `localhost:9123` can fire — which in practice is just the user's own shell. For a single-user dev setup, an extra shared-secret layer would add setup friction without meaningful protection. Captured under "Out of scope" if the threat model changes.

### Why no port conflict handling beyond logging

If port 9123 is already in use (rare, since 9123 isn't claimed by any common service), the HTTP listener fails to bind and logs an error; the file-based ingest path continues to work. The user can change the port via plugin global settings (see below) and adjust their SSH config to match.

### Plugin runtime: `@elgato/streamdeck` SDK on TypeScript

Selected over a continuation of the raw-WebSocket Node implementation. The previous attempt accumulated avoidable complexity (single-instance PID file, manual reconnect, hand-rolled context tracking) that the SDK handles natively. SDK gives us action lifecycle hooks (`onWillAppear`, `onWillDisappear`, `onKeyDown`, `onDidReceiveSettings`), typed per-instance settings, automatic reconnect, and `streamdeck link` / `streamdeck pack` for development and distribution.

## Plugin internals

### Single action, multiple instances

One action UUID: `com.nshopik.claudenotify.flash`. The user places this on the deck as many times as they want. Each placed instance has its own settings, including which event it listens to.

### Per-button settings

```ts
type FlashSettings = {
  eventType: "stop" | "idle" | "permission";   // default: "idle"
  flashMode: "static" | "pulse";               // default: "static"
  pulseIntervalMs: number;                     // default: 500
  autoTimeoutMs: number;                       // default: 30000; 0 disables
  idleIconPath?: string;                       // optional override; empty = bundled default
  alertIconPath?: string;                      // optional override; empty = bundled default
};
```

Both ingest sources (local file, remote HTTP) trigger the same logic — there is no per-button "source" setting. A button configured for `eventType: "stop"` flashes whether the Stop came from a local Claude or a remote one.

### Plugin global settings

Stored via the SDK's `setGlobalSettings` (one record per plugin install, not per button):

```ts
type GlobalSettings = {
  httpPort: number;                            // default: 9123
  httpEnabled: boolean;                        // default: true
  audio: {
    stop:       AudioConfig;
    idle:       AudioConfig;
    permission: AudioConfig;
  };
};

type AudioConfig = {
  enabled: boolean;                            // default: true
  soundPath?: string;                          // empty = bundled default WAV
  volumePercent: number;                       // 0..100, default: 80
  source: "all" | "remote" | "local";          // default: "remote"
};
```

Exposed in a small global plugin-settings UI (see Property Inspector section). If `httpEnabled` is false, the plugin runs file-watcher only. If a per-event `audio.<event>.enabled` is false, no sound plays for that event regardless of source.

### Per-button runtime state

```ts
type ButtonState = {
  alerting: boolean;
  pulseTimer?: NodeJS.Timeout;
  timeoutTimer?: NodeJS.Timeout;
  pulseFrame: 0 | 1;
};
```

### Event dispatcher

Single function that both ingest paths call. The signature carries the event source so the audio path can apply its source filter:

```ts
function dispatch(event: EventType, source: "local" | "remote"): void {
  // 1. Dismiss every currently-alerting button (clears timers, resets icon).
  // 2. For every context whose settings.eventType === event, enter alert state.
  // 3. If global audio[event].enabled and source matches audio[event].source filter,
  //    play the configured sound asynchronously.
}
```

This implements the "next event clears" dismissal rule cleanly: any incoming event — local or remote, same type or different — first quiets the deck, then arms whatever matches the new event. A repeating Stop will re-arm the same button. Audio plays once per dispatched event regardless of how many buttons match (or zero buttons match — the sound still plays if its source filter passes).

### Alert lifecycle

```
              file change OR HTTP hit (matching event)         button press
idle ───────────────────────────────────────────────▶ alerting ────────────▶ idle
  ▲                                                       │
  │                                                       │ auto-timeout (autoTimeoutMs)
  │                                                       │
  └─────────────── any other event (any source) ◀─────────┘
                  (clears prior alerts; new one starts on its own)
```

- **Static mode**: enter alert → `setImage(alertIcon)`; exit alert → `setImage(idleIcon)`.
- **Pulse mode**: enter alert → start a `setInterval` toggling between idle and alert icons every `pulseIntervalMs`; exit alert → clear the interval and `setImage(idleIcon)`.
- **Three dismissal paths** (any one returns the button to idle):
  1. User presses the button (`onKeyDown`).
  2. `autoTimeoutMs` elapses since the alert started.
  3. Any new event arrives at the dispatcher (the "next event clears" rule).

### Crash & restart resilience

- **Forced idle on connect / appear**: `onWillAppear` always calls `setImage(idleIcon)` — protects against a crashed plugin process leaving a button frozen on a pulse frame.
- **Stale event suppression at startup**: plugin records its own startup timestamp. On the first read of each sig file, if the file's mtime is older than startup, the plugin ignores it. This prevents a flood of historical alerts when the plugin loads — a Stop event fired while the plugin was offline does not trigger a flash on the next launch.
- **HTTP path has no replay**: if the plugin is down when a remote `curl` fires, the request fails fast (`--max-time 1`) and the event is simply dropped. This matches user expectation — alerts are "now" signals, not a queue.
- **Single-instance**: handled by the SDK's process model. No PID file, no manual lock.

### File watching

`signal-watcher.ts` wraps `fs.watch` with:
- A short debounce (~50ms) to coalesce duplicate events that `fs.watch` sometimes emits on Windows for a single change.
- mtime comparison against last-seen value, to ignore "rename" events that don't represent a real new signal.
- Lazy creation: if a sig file doesn't exist at startup, the plugin touches it (empty content) so `fs.watch` has something to attach to.

### HTTP listener

`http-listener.ts` is ~50 lines of `http.createServer`:
- Binds `127.0.0.1` only (never `0.0.0.0`).
- Routes only the handful of paths above; everything else returns `404`.
- Returns `204 No Content` immediately on a valid event POST and dispatches asynchronously, so a slow Stream Deck render never blocks the remote hook's `curl`.
- Refuses non-POST verbs on event routes.
- Logs every received event with timestamp for debugging.
- Gracefully shuts down on plugin termination (the SDK provides a stop hook).

## Property Inspector (UI)

### Per-button (placed on the deck):

```
┌─ Claude Notify — Flash ─────────────────────┐
│  Event type     [ Idle / waiting    ▼ ]     │
│                  - Stop (task done)          │
│                  - Idle / waiting (default)  │
│                  - Permission request        │
│                                              │
│  Idle icon      [ (default) ] [ Browse… ]   │
│  Alert icon     [ (default) ] [ Browse… ]   │
│                                              │
│  Flash mode     ◉ Static    ○ Pulse         │
│    Pulse rate   [ 500 ] ms  (only if pulse) │
│                                              │
│  Auto-dismiss   [ 30 ] seconds              │
│                                              │
│  Test           [ Flash this button ]       │
└──────────────────────────────────────────────┘
```

- Built with Elgato's `sdpi-components` (matches built-in plugin look).
- **Event type** dropdown — required, defaults to "Idle / waiting" for fresh placements.
- **Idle / Alert icon** — empty fields use the bundled default for the chosen event type. Browse opens a native file picker; the plugin reads the chosen PNG and base64-encodes for `setImage`.
- **Pulse rate** field is hidden unless Pulse is selected. Clamped to a minimum of 100ms (i.e. 10 toggles/second) to stay inside Elgato's documented 10-updates-per-second cap on key updates. Default 500ms.
- **Auto-dismiss** in seconds. `0` disables the timeout.
- **Test button** sends a synthetic alert to just the current button so the user can verify icon and mode without waiting for Claude. Bypasses both the file watcher and the HTTP listener.

### Plugin-global settings

Reachable from the Stream Deck software's "More Actions" → plugin settings:

```
┌─ Claude Notify — Plugin settings ──────────────────┐
│                                                     │
│  Remote hook listener (HTTP)                       │
│  ☑ Enabled                                         │
│  Port  [ 9123 ]                                    │
│                                                     │
│  Status                                             │
│  Local watcher: ● running                           │
│  HTTP listener: ● listening on 127.0.0.1:9123       │
│                                                     │
│  Test endpoint:  curl -X POST                       │
│    http://localhost:9123/event/stop                 │
│                                                     │
│  ──── Audio feedback ────────────────────────────── │
│                                                     │
│  Stop                                               │
│   ☑ Enabled    Source: [ Remote only ▼ ]           │
│   Sound:  [ (bundled default) ] [ Browse… ] [▶Test]│
│   Volume: [─────●────────] 80%                      │
│                                                     │
│  Idle                                               │
│   ☑ Enabled    Source: [ Remote only ▼ ]           │
│   Sound:  [ (bundled default) ] [ Browse… ] [▶Test]│
│   Volume: [─────●────────] 80%                      │
│                                                     │
│  Permission                                         │
│   ☑ Enabled    Source: [ Remote only ▼ ]           │
│   Sound:  [ (bundled default) ] [ Browse… ] [▶Test]│
│   Volume: [────────●─────] 90%                      │
└─────────────────────────────────────────────────────┘
```

Status indicators read from the live plugin state (green/red dot). The "Test endpoint" line is selectable text, useful for pasting on a remote to verify the tunnel. Each event's audio block has its own **▶ Test** button that plays the configured sound at the configured volume — bypasses both the file watcher and the HTTP listener so the user can dial in volume without triggering Claude.

## Bundled assets

Three categories of asset, all shipped with the plugin. Sizes and styling follow Elgato's marketplace guidelines so the plugin is publish-ready from v1.

### Key icons (button face — what users see on the deck)

`images/keys/`, PNG, 72×72 with @2x retina pair (144×144):

| Event | Idle | Alert |
| --- | --- | --- |
| Stop | neutral check mark | bright green check |
| Idle / waiting | neutral hourglass | bright yellow hourglass |
| Permission | neutral key | bright red key |

Style: solid colored background, white glyph, designed for legibility on a 72×72 deck key. Generated from SVG at build time, not hand-drawn. Colors are allowed here.

### Action list icons (sidebar in Stream Deck software's action picker)

`images/actions/`, **SVG preferred** (single file, scales). **Must be monochrome white stroke `#FFFFFF` on a transparent background** — no color, no solid background. Marketplace requirement.

Two distinct icons (manifest references them separately):

| Icon | Manifest field | SVG (single file) | PNG fallback (@1x + @2x) |
| --- | --- | --- | --- |
| Action icon (next to "Flash" in the action list) | `Actions[0].Icon` | `flash.svg` (designed at 20×20 viewport) | `flash.png` 20×20 + `flash@2x.png` 40×40 |
| Category icon (next to "Claude Notify" header in the action list) | top-level `CategoryIcon` | `category.svg` (designed at 28×28 viewport) | `category.png` 28×28 + `category@2x.png` 56×56 |

We ship SVG for both — one file each, no `@2x` variant needed.

### Plugin icon (marketplace listing + manifest `Icon` field)

`images/plugin-icon`, PNG, 256×256 with @2x retina pair (512×512). Colored, polished, distinct — this is the storefront thumbnail. Different from the key icons.

### Marketplace previews

`previews/`, at least one preview image showing the plugin in action (e.g. screenshot of the Property Inspector or a deck with several configured buttons). Required for marketplace submission.

## Audio feedback

A short audio cue plays when an event is dispatched, gated by per-event configuration in plugin-global settings. Audio is primarily for remote events: when Claude runs over SSH, its own PowerShell sound hooks would play on the *remote* speakers, not yours. This feature closes that gap.

### Why per-event-type and not per-button

Audio answers "did something happen?", not "did *this* button alert?". Scoping it per event type keeps things simple: five buttons configured for Stop produce one Stop sound per Claude event, not five.

### Why "remote only" by default

You already have local PowerShell sound hooks in `~/.claude/settings.json` (the `Speech On.wav` for Stop, the `Windows Message Nudge.wav` for PermissionRequest). Defaulting plugin audio to "remote only" prevents doubling up on the local machine without any setup. Override per event if you want plugin audio to fire on local events too — and remove the corresponding PowerShell sound hook from `settings.json` to avoid double playback.

### Configuration shape

`GlobalSettings.audio` (defined under "Plugin global settings" in plugin internals) has one `AudioConfig` per event type:

| Field | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | Master switch for this event's sound |
| `soundPath` | `undefined` (= bundled) | Absolute path to a WAV file. Empty falls back to the bundled default for this event |
| `volumePercent` | `80` (Permission: `90`) | 0–100 |
| `source` | `"remote"` | `"all"`, `"remote"`, or `"local"` |

Permission's higher default volume reflects that it's the most attention-critical event — Claude is blocked waiting for you.

### Bundled sounds

Three short WAVs in `sounds/`, ~300ms each, distinct cues per event:

| Event | Bundled file | Character |
| --- | --- | --- |
| Stop | `sounds/stop.wav` | Soft chime — "all done" |
| Idle | `sounds/idle.wav` | Two-note pulse — "your turn" |
| Permission | `sounds/permission.wav` | Sharp double-beep — "blocked, look here" |

Sourced from CC0 / public-domain sound packs; license attribution lives in `sounds/LICENSE.md`. Users can override any of the three with their own WAV via the file picker (including `C:\Windows\Media\*.wav`, where the user already sources `Speech On.wav` and `Windows Message Nudge.wav`).

WAV only — no MP3 or other formats. WAV has no codec dependency and Windows' built-in `System.Media.SoundPlayer` handles it natively.

### Implementation

Audio playback is a one-shot child process per event:

```ts
// pseudocode
function playSound(path: string, volumePercent: number): void {
  // Spawn powershell, non-blocking. PlayAsync overlaps cleanly if multiple events fire.
  child_process.spawn("powershell", ["-NoProfile", "-Command",
    `$p = New-Object Media.SoundPlayer '${path}'; $p.PlayAsync()`
  ], { detached: true, stdio: "ignore" }).unref();
}
```

Notes:
- `PlayAsync()` returns immediately; the child PowerShell process exits once playback starts.
- `unref()` lets the Node plugin process exit cleanly even if a child is still alive.
- Volume is *not* set via SoundPlayer (which has no volume API). For volume control, the plugin pre-bakes a volume-adjusted copy of the WAV the first time a non-100% volume is configured for an event, caches it in `%TEMP%\claude-notify-cache\<event>-<volume>.wav`, and plays the cached file. Re-encoding is straightforward WAV manipulation (modify PCM samples) and avoids per-play CPU cost.
- Concurrency: overlapping playback is allowed. Two events arriving within 100ms produce two overlapping sound processes; the OS mixes them.

### Marketplace considerations

- Bundled WAVs must be original / CC0 / properly licensed. We use CC0 sources and ship `sounds/LICENSE.md` with attribution. Captured in the marketplace asset checklist.
- No marketplace restriction on plugins playing audio (soundboard plugins exist).
- File size per WAV ≤ 50 KB (~300ms mono 16-bit at 22050 Hz is ~13 KB; even stereo 44.1 kHz fits comfortably). Total `sounds/` directory ≪ 200 KB — negligible to plugin distribution size.



`install-hooks.ps1` ships in the repo and edits `~/.claude/settings.json` additively:

- Adds the three hooks (Stop, Notification, PermissionRequest) that `Set-Content` the sig files.
- Idempotent — checks for a marker comment before re-adding.
- Preserves existing hooks the user already has (current `Stop` sound, `Notification` toast, `PermissionRequest` sound all remain).
- Detects the legacy `claude-notify-flash.sig` write and offers to migrate it to `claude-notify-stop.sig`.

### Remote (Linux / macOS) — user guide

This section is reproduced verbatim in `README.md`; it is the source of truth for what a user has to do to make remote Claude flash their local Stream Deck. No installer script — the setup is one-time copy/paste per remote host.

#### What this gives you

When Claude Code runs on a remote machine you reach via SSH, its hooks can flash buttons on your local (Windows) Stream Deck — identical visual behaviour to local Claude. Works for any Linux or macOS box you SSH into. Concurrent SSH sessions to different remotes all work simultaneously.

#### How it works (one-paragraph mental model)

The plugin on your Windows machine listens for HTTP POSTs on `127.0.0.1:9123`. Each Claude hook on the remote machine is a one-line `curl` to its own `localhost:9123`. SSH is configured with a *reverse* port-forward (`-R 9123:127.0.0.1:9123`), so the remote's `localhost:9123` is tunneled back through SSH to your Windows machine's listener. Nothing is exposed publicly; the SSH tunnel is the only path in.

#### Prerequisites

- The Claude Notify plugin is installed and running on your Windows machine.
- HTTP listener is enabled in the plugin's global settings (default: enabled, port 9123).
- You can SSH into the remote machine.
- `curl` is available on the remote (default on every mainstream Linux/macOS distribution).
- The remote's sshd allows `RemoteForward` (it does by default — `AllowTcpForwarding yes`).

#### Setup — once per remote host

**Step 1. Add a reverse-forward to your local SSH config**

Edit `~/.ssh/config` on your **Windows** machine (`C:\Users\<you>\.ssh\config`) and add:

```
Host my-dev-vm
  HostName dev-vm.example.com
  User you
  RemoteForward 9123 127.0.0.1:9123
```

To enable on every host you SSH to, use `Host *` instead of a specific name. To do it ad-hoc without config, add `-R 9123:127.0.0.1:9123` to the `ssh` command.

**Step 2. Add the three hooks to the remote's `~/.claude/settings.json`**

SSH into the remote, then merge the following into `~/.claude/settings.json` under the `hooks` key (add to existing arrays if `Stop`/`Notification`/`PermissionRequest` already exist):

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [
        { "type": "command",
          "command": "curl -s --max-time 1 -X POST http://localhost:9123/event/stop >/dev/null 2>&1 &",
          "async": true }
      ]}
    ],
    "Notification": [
      { "hooks": [
        { "type": "command",
          "command": "curl -s --max-time 1 -X POST http://localhost:9123/event/idle >/dev/null 2>&1 &",
          "async": true }
      ]}
    ],
    "PermissionRequest": [
      { "hooks": [
        { "type": "command",
          "command": "curl -s --max-time 1 -X POST http://localhost:9123/event/permission >/dev/null 2>&1 &",
          "async": true }
      ]}
    ]
  }
}
```

`--max-time 1` keeps Claude unblocked if the tunnel is down; the trailing `&` makes the hook non-blocking; `>/dev/null 2>&1` suppresses output so it doesn't pollute Claude's stderr.

#### Verify it works

After connecting (or reconnecting) to the remote with the reverse-forward in place:

**Check the tunnel** — from the remote shell:
```
curl -i http://localhost:9123/health
```
Expected: `HTTP/1.1 200 OK`. If you see `connection refused` or a timeout, the tunnel is not forwarding — jump to Troubleshooting.

**Fire a test event** — from the remote shell:
```
curl -X POST http://localhost:9123/event/stop
```
A button on your local Stream Deck configured for the Stop event should flash.

**Trigger a real Claude event** — run a short Claude task on the remote and wait for it to finish; the Stop hook fires, the deck flashes.

#### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `curl: connection refused` from remote | SSH session opened without `-R`; or plugin not running on Windows; or HTTP listener disabled in plugin settings | Reconnect ensuring `-R 9123:127.0.0.1:9123` is set; verify plugin's global settings show "HTTP listener: listening on 127.0.0.1:9123" |
| Tunnel responds but deck doesn't flash | No button configured for that event type, or the button's event type is different | Open Property Inspector on a button, set Event type to match (Stop / Idle / Permission); use the per-button Test button to verify |
| `bind: Address already in use` warning when SSH connects | A previous SSH session to the same remote is still holding the reverse port | Disconnect the old session; or pick a different port (change plugin global setting + `-R` line + curl URLs to match) |
| `Permission denied` or "channel 3: open failed" on `-R` | Remote sshd has `AllowTcpForwarding no` (rare, hardened servers) | Ask sysadmin to enable; or use a different transport (out of scope) |
| `bash: curl: command not found` on remote | Minimal container/distro without curl | Install curl, or substitute the hook command with: `wget -q --tries=1 --timeout=1 --method=POST http://localhost:9123/event/stop -O /dev/null &` |
| Multiple concurrent Claude sessions to same remote, only one flashes | The `-R` reverse port can only be bound once per remote | This is expected. Hooks from non-bound sessions silently fail (`--max-time 1` swallows the error). Use one Claude session per remote at a time, or use distinct ports per session |
| Plugin says HTTP listener "failed to bind" on Windows | Port 9123 is in use by something else on Windows | Change `httpPort` in plugin global settings; update your `-R` line and the remote curl URLs to match |
| WSL2 on the same Windows box | WSL2 default NAT means `localhost:9123` from inside WSL doesn't reach the Windows host | Use Windows 11 mirrored networking mode (`[wsl2] networkingMode=mirrored` in `.wslconfig`); or treat WSL like a remote and use a reverse-forward via SSH-to-WSL |

#### What the plugin does *not* do

The plugin does not write to either machine's `~/.claude/settings.json`, does not establish the SSH tunnel for you, and does not modify your `~/.ssh/config`. All three are one-time manual setup steps owned by the user.

## Cleanup of prior attempt

Before the new plugin is linked:

1. Delete `%APPDATA%\Elgato\StreamDeck\Plugins\com.nshopik.claudenotify.sdPlugin\` (the old install and its `claude-notify-plugin-backup` subfolder).
2. After local hook migration runs, the legacy `%TEMP%\claude-notify-flash.sig` is no longer written; clean it up if present.
3. The new plugin reuses the same UUID (`com.nshopik.claudenotify`), so any buttons already placed on the Stream Deck profile rebind to the new build automatically.

## Project layout

```
claudenotify/
├─ src/
│  ├─ plugin.ts                    # SDK entrypoint; registers FlashAction; starts watchers + HTTP server
│  ├─ actions/flash-action.ts      # FlashAction class
│  ├─ dispatcher.ts                # event dispatcher (shared by both ingest paths)
│  ├─ signal-watcher.ts            # fs.watch wrapper: debounce, mtime gate, lazy-touch
│  ├─ http-listener.ts             # 127.0.0.1 HTTP server for remote hooks
│  ├─ audio-player.ts              # PowerShell SoundPlayer spawn + volume-adjusted WAV cache
│  └─ icons.ts                     # bundled icon loader + base64 cache
├─ ui/
│  ├─ flash.html                   # per-button Property Inspector
│  └─ plugin-settings.html         # plugin-global settings UI
├─ images/
│  ├─ keys/                        # 6 PNG pairs, colored: {stop|idle|permission}-{idle|alert}.png + @2x
│  ├─ actions/
│  │  ├─ category.svg              # 28×28 viewport, monochrome white #FFFFFF on transparent
│  │  └─ flash.svg                 # 20×20 viewport, monochrome white #FFFFFF on transparent
│  ├─ plugin-icon.png              # 256×256, colored
│  └─ plugin-icon@2x.png           # 512×512
├─ sounds/
│  ├─ stop.wav                     # ~300ms cue
│  ├─ idle.wav                     # ~300ms cue
│  ├─ permission.wav               # ~300ms cue
│  └─ LICENSE.md                   # CC0 attribution for bundled sounds
├─ previews/                       # marketplace preview screenshots (≥1)
├─ manifest.json                   # maintained by streamdeck CLI
├─ package.json
├─ tsconfig.json
├─ rollup.config.mjs               # scaffolded by `streamdeck create`
├─ install-hooks.ps1               # one-shot local Windows hook installer
└─ README.md                       # includes copy-paste remote hook snippet + SSH config
```

## Toolchain

- `npm i -D @elgato/cli` provides the `streamdeck` CLI.
- `streamdeck create` scaffolds the manifest, rollup config, and TS skeleton.
- `streamdeck link` during development hot-loads the `.sdPlugin` build into the running Stream Deck software.
- `streamdeck pack` validates the plugin and produces a distributable `.streamDeckPlugin` file.

## Marketplace readiness

The plugin is designed from v1 to be submittable to the [Elgato Marketplace](https://maker.elgato.com) without a follow-up "publish-prep" rewrite. None of the items below change the architecture; they are packaging/asset/manifest hygiene.

### Manifest fields (all required for marketplace)

| Field | Value |
| --- | --- |
| `Name` | `Claude Notify` |
| `UUID` | `com.nshopik.claudenotify` |
| `Author` | `Nikolay Shopik` |
| `Category` | `Claude Notify` (matches plugin name, per guideline) |
| `Description` | One sentence accurately describing functionality (≤ marketplace limit) |
| `URL` | GitHub repo / homepage — required field |
| `Version` | Numeric quad like `1.0.0.0` |
| `Icon` | `images/plugin-icon` (no extension; SDK resolves `.png` and `@2x.png`) |
| `CategoryIcon` | `images/actions/category` (no extension; SVG, scales) |
| `SDKVersion` | `3` |
| `Software.MinimumVersion` | `"6.9"` |
| `OS` | `[{ "Platform": "windows", "MinimumVersion": "10" }]` |
| `Actions[0].Name` | `Flash` (≤ 30 chars) |
| `Actions[0].UUID` | `com.nshopik.claudenotify.flash` |
| `Actions[0].Icon` | `images/actions/flash` (no extension; SVG) |
| `Actions[0].States[0].Image` | `images/keys/idle-idle` (default placeholder; runtime `setImage` overrides per settings) |

### Asset checklist (exact sizes per Elgato guidelines)

| Asset | File(s) | Format | @1x | @2x |
| --- | --- | --- | --- | --- |
| Plugin icon (marketplace + manifest top-level `Icon`) | `images/plugin-icon.png` + `plugin-icon@2x.png` | PNG (only) | 256×256 | 512×512 |
| Category icon (`CategoryIcon` field) | `images/actions/category.svg` | SVG | designed at 28×28 viewport | not needed (SVG scales) |
| Action icon (`Actions[0].Icon`) | `images/actions/flash.svg` | SVG | designed at 20×20 viewport | not needed (SVG scales) |
| Key icons (`Actions[0].States[].Image`) — 6 pairs | `images/keys/{stop\|idle\|permission}-{idle\|alert}.png` + `@2x.png` | PNG | 72×72 | 144×144 |
| Marketplace previews | `previews/*.png` (≥1) | PNG/JPG | — | — |
| Bundled sounds | `sounds/{stop,idle,permission}.wav` + `LICENSE.md` | WAV | — | — |

**Style rules:**
- Plugin icon: colored, polished, distinctive.
- Category + Action icons: **monochrome white stroke `#FFFFFF` on transparent background** — marketplace requirement, no color, no solid background.
- Key icons: colored backgrounds with white glyphs, designed for legibility on a 72×72 deck key.

### Behavior guardrails for compliance

- **Pulse rate** clamped to ≥ 100ms (the Property Inspector enforces this; the action also defends server-side). Stays under Elgato's 10-updates/sec cap.
- **No "Save" button** in the Property Inspector — settings are autosaved by the SDK on change.
- **No donation / sponsor links** in the Property Inspector or plugin-global settings UI.
- **No static action** — the action is fully configurable (event type, icons, mode, timeout). Compliant by design.
- **Action and category names** ≤ 30 characters. "Flash" / "Claude Notify" both qualify.
- **Bundled WAVs** are CC0 / properly licensed; attribution in `sounds/LICENSE.md`. See "Audio feedback" section.

### What is *not* a compliance concern (verified)

- **Localhost HTTP listener** is not called out in the guidelines and is common in published plugins (OBS, Home Assistant, MQTT). Bound to `127.0.0.1` only — no external exposure.
- **`fs.watch` on `%TEMP%`** is plain Node.js filesystem usage, no different from any plugin that reads config files.
- **Editing `~/.claude/settings.json`** is performed by the *separate* `install-hooks.ps1` script that the user runs manually; the plugin itself does not touch it at runtime.

### Submission process (for reference, not part of this build)

1. Create / log into account at `https://maker.elgato.com`.
2. Run `streamdeck pack com.nshopik.claudenotify.sdPlugin` → produces `.streamDeckPlugin`.
3. Upload via Maker Console; choose "Publish after review".
4. Wait for Elgato review (timeline not publicly documented). Maker support: `maker@elgato.com`. Beta-testing community on the Maker Discord.
5. Optional but recommended: enable DRM (already covered by `SDKVersion: 3` + `Software.MinimumVersion: "6.9"` in the manifest).

## Testing strategy

- **Unit-ish tests for `signal-watcher.ts`**: drive against `os.tmpdir()`, verify mtime-gate (stale events ignored), debounce (coalesced rapid writes), lazy-touch (missing file is created).
- **Unit-ish tests for `http-listener.ts`**: spin the server on an ephemeral port, hit each route via `node:http` request, assert `204` on valid POSTs / `404` on bad routes / `405` on bad verbs / dispatcher called once per request with `source: "remote"`.
- **Unit-ish tests for `audio-player.ts`**: assert correct PowerShell argv is composed for a given path/volume; assert volume-adjusted WAVs are cached on first use and reused thereafter; assert source-filter logic skips playback for non-matching sources.
- **Per-button "Test" command**: shipped in the per-button Property Inspector, fires a synthetic alert without touching either ingest path. Used both for development and for users to verify icon configuration.
- **Per-event "▶ Test" command**: shipped in plugin-global settings, plays the configured sound at the configured volume — for dialing in volume without triggering Claude.
- **Manual end-to-end (local)**: trigger a real Claude Code `Stop` on Windows, watch the deck, confirm dismissal through each of the three paths.
- **Manual end-to-end (remote)**: open an SSH session to a real remote with `-R 9123:localhost:9123`, run `curl -X POST http://localhost:9123/event/stop` from the remote shell, confirm the local deck flashes *and* the local speaker plays the configured sound. Then trigger a real Claude `Stop` on the remote.

## Open questions

None at design time. Implementation may surface SDK quirks (e.g. how the SDK handles `setImage` immediately after `onWillAppear`, or how plugin-global settings UIs are discovered by Stream Deck software in the current SDK version), but those are tactical and don't change the design.

## Out of scope, captured for later

- **Per-host buttons**: a "host" field on button settings, populated by an `X-Claude-Host` header the remote hook sends. Easy extension once the dispatcher exists.
- **Bundling additional events** (SubagentStop, errors, custom hook commands): straightforward — one new sig file path + one new HTTP route + one new option in the dropdown + one icon pair.
- **Shared-secret token auth** on the HTTP listener: if the threat model changes (multi-tenant remote, untrusted shells), add an `X-Claude-Notify-Token` header check against a token persisted in `%APPDATA%`.
- **A "snooze all" Stream Deck action** that clears every alerting button.
- **Cross-platform Stream Deck plugin support**: would require generalizing the local sig-file path away from `%TEMP%`. Remote hook snippets already work on any POSIX system.
