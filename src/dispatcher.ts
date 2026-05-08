import type { EventType, EventSource, GlobalSettings, FlashSettings, ButtonState } from "./types.js";
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

  // Arms buttons whose eventType === event. Re-arming clears any prior alerts
  // of the same event type. The one cross-dismiss rule: dispatch("stop") also
  // dismisses any armed permission button (turn ended → permission stale).
  dispatch(event: EventType, source: EventSource): void {
    const buttons = this.opts.getButtons();
    let dismissed = 0;
    let armed = 0;
    let crossDismiss = false;
    for (const [, btn] of buttons) {
      if (!btn.state.alerting) continue;
      const sameEvent = btn.settings.eventType === event;
      const stopCrossesPermission = event === "stop" && btn.settings.eventType === "permission";
      if (!sameEvent && !stopCrossesPermission) continue;
      if (stopCrossesPermission) crossDismiss = true;
      btn.dismiss();
      dismissed++;
    }
    for (const [, btn] of buttons) {
      if (btn.settings.eventType === event) { btn.alert(); armed++; }
    }
    this.log(`dispatch event=${event} source=${source} buttons=${buttons.size} dismissed=${dismissed} armed=${armed} cross-dismiss=${crossDismiss}`);
    const audioCfg = this.opts.getGlobalSettings().audio[event];
    const path = audioCfg.soundPath ?? defaultSoundPath(event);
    if (!path) return;
    this.opts.audioPlayer.play(path, audioCfg.volumePercent);
  }

  // Dismisses any alerting buttons whose eventType matches. No effect on others.
  // Wired to the permission-resolved signal (PostToolUse / PostToolUseFailure /
  // PermissionDenied → dismiss("permission")).
  dismiss(event: EventType): void {
    const buttons = this.opts.getButtons();
    let dismissed = 0;
    for (const [, btn] of buttons) {
      if (!btn.state.alerting) continue;
      if (btn.settings.eventType !== event) continue;
      btn.dismiss();
      dismissed++;
    }
    this.log(`dismiss event=${event} buttons=${buttons.size} dismissed=${dismissed}`);
  }

  // Dismisses every alerting button. Wired to UserPromptSubmit / SessionStart.
  dismissAll(): void {
    const buttons = this.opts.getButtons();
    let dismissed = 0;
    for (const [, btn] of buttons) {
      if (!btn.state.alerting) continue;
      btn.dismiss();
      dismissed++;
    }
    this.log(`dismissAll buttons=${buttons.size} dismissed=${dismissed}`);
  }
}
