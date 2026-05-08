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
};

export class Dispatcher {
  private opts: DispatcherOpts;

  constructor(opts: DispatcherOpts) {
    this.opts = opts;
  }

  dispatch(event: EventType, source: EventSource): void {
    const buttons = this.opts.getButtons();
    for (const [, btn] of buttons) {
      if (btn.state.alerting) btn.dismiss();
    }
    for (const [, btn] of buttons) {
      if (btn.settings.eventType === event) btn.alert();
    }
    // Audio fires only for remote events; local hook scripts play their own sound.
    if (source !== "remote") return;
    const audioCfg = this.opts.getGlobalSettings().audio[event];
    if (!audioCfg.enabled) return;
    const path = audioCfg.soundPath ?? defaultSoundPath(event);
    this.opts.audioPlayer.play(path, audioCfg.volumePercent);
  }

  dismissAll(): void {
    const buttons = this.opts.getButtons();
    for (const [, btn] of buttons) {
      if (btn.state.alerting) btn.dismiss();
    }
  }
}
