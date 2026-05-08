import { describe, it, expect, beforeEach, vi } from "vitest";
import { Dispatcher } from "../src/dispatcher.js";
import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_FLASH_SETTINGS,
  type ButtonState,
  type FlashSettings,
  type GlobalSettings,
} from "../src/types.js";
import type { DispatchableButton } from "../src/dispatcher.js";

type FakeButton = {
  settings: FlashSettings;
  state: ButtonState;
  alert: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
};

function makeButton(eventType: FlashSettings["eventType"], alerting = false): FakeButton {
  return {
    settings: { ...DEFAULT_FLASH_SETTINGS, eventType },
    state: { alerting, pulseFrame: 0 },
    alert: vi.fn(),
    dismiss: vi.fn(),
  };
}

let audioPlayer: { play: ReturnType<typeof vi.fn> };
let buttons: Map<string, FakeButton>;
let globals: GlobalSettings;

beforeEach(() => {
  audioPlayer = { play: vi.fn() };
  buttons = new Map();
  globals = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS));
});

function dispatcher() {
  return new Dispatcher({
    audioPlayer: audioPlayer as unknown as { play: (p: string, v: number) => void },
    getGlobalSettings: () => globals,
    getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
  });
}

describe("Dispatcher", () => {
  it("does nothing when no button matches the event type", () => {
    buttons.set("a", makeButton("idle"));
    dispatcher().dispatch("stop", "remote");
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("a")!.dismiss).not.toHaveBeenCalled();
  });

  it("calls alert() on buttons whose eventType matches", () => {
    buttons.set("a", makeButton("stop"));
    buttons.set("b", makeButton("idle"));
    buttons.set("c", makeButton("stop"));
    dispatcher().dispatch("stop", "remote");
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
    expect(buttons.get("b")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("c")!.alert).toHaveBeenCalledTimes(1);
  });

  it("dismisses every alerting button before arming new ones", () => {
    buttons.set("a", makeButton("stop", true));
    buttons.set("b", makeButton("permission", true));
    buttons.set("c", makeButton("idle"));
    dispatcher().dispatch("idle", "remote");
    expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("b")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("c")!.alert).toHaveBeenCalledTimes(1);
  });

  it("plays audio for remote events", () => {
    globals.audio.stop.volumePercent = 75;
    buttons.set("a", makeButton("stop"));
    dispatcher().dispatch("stop", "remote");
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledWith(expect.stringContaining("Speech On.wav"), 75);
  });

  it("never plays audio for local events (local hooks play their own sound)", () => {
    buttons.set("a", makeButton("stop"));
    dispatcher().dispatch("stop", "local");
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("skips audio when audio.enabled is false", () => {
    globals.audio.stop.enabled = false;
    buttons.set("a", makeButton("stop"));
    dispatcher().dispatch("stop", "remote");
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("uses configured soundPath when set", () => {
    globals.audio.permission.soundPath = "C:\\custom\\alert.wav";
    buttons.set("a", makeButton("permission"));
    dispatcher().dispatch("permission", "remote");
    expect(audioPlayer.play).toHaveBeenCalledWith("C:\\custom\\alert.wav", expect.any(Number));
  });

  it("dismissAll dismisses every alerting button without arming or playing audio", () => {
    buttons.set("a", makeButton("stop", true));
    buttons.set("b", makeButton("idle", true));
    buttons.set("c", makeButton("permission", false));
    dispatcher().dismissAll();
    expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("b")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("c")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });
});
