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

describe("Dispatcher.dispatch", () => {
  it("does nothing when no button matches the event type", () => {
    buttons.set("a", makeButton("permission"));
    dispatcher().dispatch("stop", "remote");
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("a")!.dismiss).not.toHaveBeenCalled();
  });

  it("calls alert() on every button whose eventType matches", () => {
    buttons.set("a", makeButton("stop"));
    buttons.set("b", makeButton("permission"));
    buttons.set("c", makeButton("stop"));
    dispatcher().dispatch("stop", "remote");
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
    expect(buttons.get("b")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("c")!.alert).toHaveBeenCalledTimes(1);
  });

  it("dispatch(stop) re-arms own slot by dismissing prior stop alerts first", () => {
    buttons.set("a", makeButton("stop", true));
    dispatcher().dispatch("stop", "remote");
    expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });

  it("dispatch(permission) re-arms own slot but leaves stop and task-completed alone", () => {
    buttons.set("stop1", makeButton("stop", true));
    buttons.set("perm1", makeButton("permission", true));
    buttons.set("perm2", makeButton("permission", false));
    buttons.set("task1", makeButton("task-completed", true));
    dispatcher().dispatch("permission", "remote");
    expect(buttons.get("stop1")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("task1")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("perm1")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("perm1")!.alert).toHaveBeenCalledTimes(1);
    expect(buttons.get("perm2")!.alert).toHaveBeenCalledTimes(1);
  });

  it("dispatch(task-completed) re-arms own slot but leaves stop and permission alone", () => {
    buttons.set("stop1", makeButton("stop", true));
    buttons.set("perm1", makeButton("permission", true));
    buttons.set("task1", makeButton("task-completed", true));
    dispatcher().dispatch("task-completed", "remote");
    expect(buttons.get("stop1")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("perm1")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("task1")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("task1")!.alert).toHaveBeenCalledTimes(1);
  });

  it("dispatch(stop) cross-dismisses alerting permission buttons (turn ended → permission stale)", () => {
    buttons.set("perm1", makeButton("permission", true));
    buttons.set("stop1", makeButton("stop"));
    dispatcher().dispatch("stop", "remote");
    expect(buttons.get("perm1")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("stop1")!.alert).toHaveBeenCalledTimes(1);
  });

  it("dispatch(stop) re-arms own slot AND cross-dismisses permission when both are alerting", () => {
    buttons.set("stop1", makeButton("stop", true));
    buttons.set("perm1", makeButton("permission", true));
    dispatcher().dispatch("stop", "remote");
    expect(buttons.get("stop1")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("stop1")!.alert).toHaveBeenCalledTimes(1);
    expect(buttons.get("perm1")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("perm1")!.alert).not.toHaveBeenCalled();
  });

  it("dispatch(stop) preserves alerting task-completed buttons", () => {
    buttons.set("task1", makeButton("task-completed", true));
    buttons.set("stop1", makeButton("stop"));
    dispatcher().dispatch("stop", "remote");
    expect(buttons.get("task1")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("stop1")!.alert).toHaveBeenCalledTimes(1);
  });

  it("plays audio for remote events", () => {
    globals.audio.stop.volumePercent = 75;
    buttons.set("a", makeButton("stop"));
    dispatcher().dispatch("stop", "remote");
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledWith(expect.stringContaining("Speech On.wav"), 75);
  });

  it("plays audio for local events too (soundPath is the only gate)", () => {
    buttons.set("a", makeButton("stop"));
    dispatcher().dispatch("stop", "local");
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("skips audio when soundPath is the empty string (explicit mute)", () => {
    globals.audio.stop.soundPath = "";
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

  it("task-completed plays its default sound (Windows Notify System Generic.wav)", () => {
    buttons.set("a", makeButton("task-completed"));
    dispatcher().dispatch("task-completed", "remote");
    expect(audioPlayer.play).toHaveBeenCalledWith(
      expect.stringContaining("Windows Notify System Generic.wav"),
      expect.any(Number),
    );
  });
});

describe("Dispatcher.dismiss", () => {
  it("dismisses only alerting buttons whose eventType matches", () => {
    buttons.set("stop1", makeButton("stop", true));
    buttons.set("perm1", makeButton("permission", true));
    buttons.set("task1", makeButton("task-completed", true));
    dispatcher().dismiss("permission");
    expect(buttons.get("stop1")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("perm1")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("task1")!.dismiss).not.toHaveBeenCalled();
  });

  it("does not arm any button or play audio", () => {
    buttons.set("perm1", makeButton("permission", true));
    buttons.set("perm2", makeButton("permission", false));
    dispatcher().dismiss("permission");
    expect(buttons.get("perm1")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("perm2")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("ignores buttons that match eventType but aren't alerting", () => {
    buttons.set("perm1", makeButton("permission", false));
    dispatcher().dismiss("permission");
    expect(buttons.get("perm1")!.dismiss).not.toHaveBeenCalled();
  });
});

describe("Dispatcher.dismissAll", () => {
  it("dismisses every alerting button without arming or playing audio", () => {
    buttons.set("a", makeButton("stop", true));
    buttons.set("b", makeButton("task-completed", true));
    buttons.set("c", makeButton("permission", false));
    dispatcher().dismissAll();
    expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("b")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("c")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });
});
