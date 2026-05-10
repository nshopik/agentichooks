# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Added

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
