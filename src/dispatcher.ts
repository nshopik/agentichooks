import { STICKY_EVENT_TYPES, type EventType, type EventSource, type GlobalSettings, type FlashSettings, type ButtonState } from "./types.js";
import { defaultSoundPath } from "./system-sounds.js";

export type DispatchableButton = {
  settings: FlashSettings;
  state: ButtonState;
  alert: () => void;
  dismiss: () => void;
};

export type DispatcherOpts = {
  audioPlayer: { play: (path: string, volumePercent: number) => void };
  getGlobalSettings: () => GlobalSettings;
  getButtons: () => Map<string, DispatchableButton>;
  log?: (msg: string) => void;
};

export class Dispatcher {
  private opts: DispatcherOpts;

  constructor(opts: DispatcherOpts) {
    this.opts = opts;
  }

  private log(msg: string): void {
    this.opts.log?.(msg);
  }

  dispatch(event: EventType, source: EventSource): void {
    const buttons = this.opts.getButtons();
    // dispatch("stop") clears everything (turn ended). dispatch("task-completed")
    // also clears everything so the new task-completed alert re-arms cleanly.
    // Other dispatches preserve sticky event types (e.g. an idle or permission
    // alert mid-turn shouldn't nuke a task-completed alert).
    const preserveSticky = event !== "stop" && !STICKY_EVENT_TYPES.includes(event);
    let dismissed = 0;
    let armed = 0;
    for (const [, btn] of buttons) {
      if (!btn.state.alerting) continue;
      if (preserveSticky && STICKY_EVENT_TYPES.includes(btn.settings.eventType)) continue;
      btn.dismiss();
      dismissed++;
    }
    for (const [, btn] of buttons) {
      if (btn.settings.eventType === event) { btn.alert(); armed++; }
    }
    this.log(`dispatch event=${event} source=${source} buttons=${buttons.size} dismissed=${dismissed} armed=${armed} preserveSticky=${preserveSticky}`);
    // Audio plays for any source. The per-event audio.enabled toggle in the
    // PI is authoritative.
    const audioCfg = this.opts.getGlobalSettings().audio[event];
    if (!audioCfg.enabled) return;
    const path = audioCfg.soundPath ?? defaultSoundPath(event);
    if (!path) return;
    this.opts.audioPlayer.play(path, audioCfg.volumePercent);
  }

  // Pass `except` to keep certain event types alerting (used by the "active-soft"
  // signal so PostToolUse doesn't dismiss a task-completed alert mid-turn).
  dismissAll(except: ReadonlyArray<EventType> = []): void {
    const buttons = this.opts.getButtons();
    let dismissed = 0;
    let preserved = 0;
    for (const [, btn] of buttons) {
      if (!btn.state.alerting) continue;
      if (except.includes(btn.settings.eventType)) { preserved++; continue; }
      btn.dismiss();
      dismissed++;
    }
    this.log(`dismissAll except=${except.length ? except.join(",") : "(none)"} buttons=${buttons.size} dismissed=${dismissed} preserved=${preserved}`);
  }
}
