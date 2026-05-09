# Changelog

All notable changes to this project will be documented in this file.

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
