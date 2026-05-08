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

  it("plays audio for local events too (audio.enabled is the only gate)", () => {
    buttons.set("a", makeButton("stop"));
    dispatcher().dispatch("stop", "local");
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
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

  it("idle has no default sound and skips play() unless soundPath is set", () => {
    buttons.set("a", makeButton("idle"));
    dispatcher().dispatch("idle", "remote");
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("task-completed plays its default sound (Windows Notify System Generic.wav)", () => {
    buttons.set("a", makeButton("task-completed"));
    dispatcher().dispatch("task-completed", "remote");
    expect(audioPlayer.play).toHaveBeenCalledWith(expect.stringContaining("Windows Notify System Generic.wav"), expect.any(Number));
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

  it("dismissAll(except=['task-completed']) preserves alerting task-completed buttons", () => {
    buttons.set("a", makeButton("stop", true));
    buttons.set("b", makeButton("task-completed", true));
    buttons.set("c", makeButton("permission", true));
    dispatcher().dismissAll(["task-completed"]);
    expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("b")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("c")!.dismiss).toHaveBeenCalledTimes(1);
  });

  it("dispatch(idle) preserves an alerting task-completed button", () => {
    buttons.set("a", makeButton("task-completed", true));
    buttons.set("b", makeButton("idle", false));
    dispatcher().dispatch("idle", "remote");
    expect(buttons.get("a")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("b")!.alert).toHaveBeenCalledTimes(1);
  });

  it("dispatch(permission) preserves an alerting task-completed button", () => {
    buttons.set("a", makeButton("task-completed", true));
    buttons.set("b", makeButton("permission", false));
    dispatcher().dispatch("permission", "remote");
    expect(buttons.get("a")!.dismiss).not.toHaveBeenCalled();
    expect(buttons.get("b")!.alert).toHaveBeenCalledTimes(1);
  });

  it("dispatch(stop) DOES dismiss an alerting task-completed button", () => {
    buttons.set("a", makeButton("task-completed", true));
    buttons.set("b", makeButton("stop", false));
    dispatcher().dispatch("stop", "remote");
    expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("b")!.alert).toHaveBeenCalledTimes(1);
  });

  it("dispatch(task-completed) re-arms by clearing existing task-completed alerts", () => {
    buttons.set("a", makeButton("task-completed", true));
    dispatcher().dispatch("task-completed", "remote");
    expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });
});
