# Changelog

All notable changes to this project will be documented in this file.

## 0.9.0 — 2026-05-09 — first public beta release

First public release of **Agentic Hooks** (formerly internal-only "Agent Hook Notify"
/ "Claude Notify"). Distributed via GitHub Releases as a beta; Elgato Marketplace
submission targeted for the 1.0 cut.

### Changed (breaking)

- `audio[event].enabled` removed from global settings. The per-event audio gate
  is now `soundPath` alone, with three states:
  - unset (`undefined`) → bundled default plays (system WAV) if one exists
  - empty string (`""`) → explicit mute
  - file path → user-picked sound
  Use the new **Mute** button in the Property Inspector to silence an event;
  use **Reset to default** to restore the bundled default sound.

### Added

- Property Inspector shows the bundled default WAV file name in each event's
  file picker (via sdpi-file's `default` attribute), so it's obvious which
  events have audio configured.
- Mute / Reset to default buttons under each per-event file picker.
- Local-vendored `sdpi-components.js` (no runtime CDN dependency).
- MIT `LICENSE`.

### Removed

- Per-event "Audio enabled" checkbox. Functionality folded into the file picker
  via the tri-state semantics above.

### Notes

- macOS support is **experimental**. Windows is the tested install path; macOS
  code paths (afplay, system sounds, hook installer) compile and are wired up
  but have not been validated end-to-end on a real Mac. Reports welcome.
