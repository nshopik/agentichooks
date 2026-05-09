import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  const btn: FakeButton = {
    settings: { ...DEFAULT_FLASH_SETTINGS, eventType },
    state: { alerting, pulseFrame: 0 },
    alert: vi.fn(),
    dismiss: vi.fn(),
  };
  // Keep the alerting bit in sync with what FlashAction would do, so isAnyArmed
  // reflects reality across re-fires within a single test.
  btn.alert.mockImplementation(() => { btn.state.alerting = true; });
  btn.dismiss.mockImplementation(() => { btn.state.alerting = false; });
  return btn;
}

let audioPlayer: { play: ReturnType<typeof vi.fn> };
let buttons: Map<string, FakeButton>;
let globals: GlobalSettings;

beforeEach(() => {
  vi.useFakeTimers();
  audioPlayer = { play: vi.fn() };
  buttons = new Map();
  globals = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS));
});

afterEach(() => {
  vi.useRealTimers();
});

function dispatcher() {
  return new Dispatcher({
    audioPlayer: audioPlayer as unknown as { play: (p: string, v: number) => void },
    getGlobalSettings: () => globals,
    getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
  });
}

describe("Dispatcher.handleRoute — pending → fires after delay", () => {
  it("does not alert or play audio before the delay elapses", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(999);
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("fires audio + alert exactly when the delay elapses", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(1000);
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("uses the per-event-type delay configured in globals", () => {
    globals.alertDelay.stop = 5000;
    buttons.set("a", makeButton("stop"));
    const d = dispatcher();
    d.handleRoute("/event/stop");
    vi.advanceTimersByTime(4999);
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — pending cancelled by clearing route (the bug fix)", () => {
  it("permission-request followed by post-tool-use within delay → no audio, no alert", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/post-tool-use");
    vi.advanceTimersByTime(5000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
  });

  it("permission-denied also cancels a pending permission alert", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/permission-denied");
    vi.advanceTimersByTime(5000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("post-tool-use-failure also cancels a pending permission alert", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/post-tool-use-failure");
    vi.advanceTimersByTime(5000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });
});

describe("Dispatcher.handleRoute — same-type arm during PENDING is no-op (no timer extension)", () => {
  it("two permission-requests 500ms apart fire exactly one alert at t=1000", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(500); // total 1000 from first arm
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000); // would be t=2000 — no second fire
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — matrix-driven cross-type clearing", () => {
  it("/event/stop clears pending permission and pending task-completed before arming stop", () => {
    buttons.set("perm", makeButton("permission"));
    buttons.set("task", makeButton("task-completed"));
    buttons.set("stop", makeButton("stop"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    d.handleRoute("/event/task-completed");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/stop");
    vi.advanceTimersByTime(5000);
    // Only stop fires; the cancelled permission and task-completed never alert.
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("/event/stop-failure has the same clears+arms as /event/stop", () => {
    buttons.set("perm", makeButton("permission"));
    buttons.set("stop", makeButton("stop"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/stop-failure");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
  });

  it("/event/task-completed clears pending permission while arming task-completed", () => {
    buttons.set("perm", makeButton("permission"));
    buttons.set("task", makeButton("task-completed"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/task-completed");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("task")!.alert).toHaveBeenCalledTimes(1);
  });

  it("/event/permission-request does not clear stop or task-completed", () => {
    buttons.set("stop", makeButton("stop"));
    buttons.set("task", makeButton("task-completed"));
    buttons.set("perm", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/stop");
    d.handleRoute("/event/task-completed");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(5000);
    // All three pending timers eventually fire — permission-request only arms its own type.
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    expect(buttons.get("task")!.alert).toHaveBeenCalledTimes(1);
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — session-start / user-prompt-submit clear all three", () => {
  it("session-start cancels all pending alerts", () => {
    buttons.set("stop", makeButton("stop"));
    buttons.set("perm", makeButton("permission"));
    buttons.set("task", makeButton("task-completed"));
    const d = dispatcher();
    d.handleRoute("/event/stop");
    d.handleRoute("/event/permission-request");
    d.handleRoute("/event/task-completed");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/session-start");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("user-prompt-submit cancels all pending alerts", () => {
    buttons.set("stop", makeButton("stop"));
    buttons.set("perm", makeButton("permission"));
    buttons.set("task", makeButton("task-completed"));
    const d = dispatcher();
    d.handleRoute("/event/stop");
    d.handleRoute("/event/permission-request");
    d.handleRoute("/event/task-completed");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/user-prompt-submit");
    vi.advanceTimersByTime(5000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("session-start dismisses already-armed buttons too", () => {
    buttons.set("stop", makeButton("stop", true));
    buttons.set("perm", makeButton("permission", true));
    const d = dispatcher();
    d.handleRoute("/event/session-start");
    expect(buttons.get("stop")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — re-fire when already ARMED", () => {
  it("same-type arm on an armed slot re-fires (audio plays twice)", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
    // Now ARMED. Another permission-request fires immediately, no fresh wait.
    d.handleRoute("/event/permission-request");
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
    expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1); // re-arm dismisses prior
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(2);
  });
});

describe("Dispatcher.handleRoute — delayMs = 0 opt-out", () => {
  it("fires immediately with no pending state when alertDelay is 0", () => {
    globals.alertDelay.permission = 0;
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — pre-tool-use clears stop (agentic loop restart)", () => {
  it("pre-tool-use cancels a pending stop alert (loop restarted without user input)", () => {
    buttons.set("a", makeButton("stop"));
    const d = dispatcher();
    d.handleRoute("/event/stop");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/pre-tool-use");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("pre-tool-use dismisses an already-armed stop alert", () => {
    buttons.set("a", makeButton("stop", true));
    const d = dispatcher();
    d.handleRoute("/event/pre-tool-use");
    expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1);
  });

  it("pre-tool-use does not affect a pending permission", () => {
    buttons.set("perm", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/pre-tool-use");
    vi.advanceTimersByTime(2000);
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);
  });

  it("pre-tool-use does not affect a pending task-completed", () => {
    buttons.set("task", makeButton("task-completed"));
    const d = dispatcher();
    d.handleRoute("/event/task-completed");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/pre-tool-use");
    vi.advanceTimersByTime(2000);
    expect(buttons.get("task")!.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — info-only and unknown routes", () => {
  it("unknown route is a silent no-op", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    d.handleRoute("/event/this-does-not-exist");
    vi.advanceTimersByTime(1000);
    // The pending permission still fires; the unknown route had no effect.
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });

  it("clearing route with no matching pending or armed state is a no-op", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/post-tool-use");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("a")!.dismiss).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });
});

describe("Dispatcher.handleRoute — audio behavior preserved", () => {
  it("plays the configured soundPath at fire time", () => {
    globals.audio.permission.soundPath = "C:\\custom\\alert.wav";
    globals.audio.permission.volumePercent = 75;
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).toHaveBeenCalledWith("C:\\custom\\alert.wav", 75);
  });

  it("skips audio when soundPath is the empty string (explicit mute)", () => {
    globals.audio.permission.soundPath = "";
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
    // Visual still fires though.
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });

  it("plays no sound for task-completed when soundPath is unset (no default)", () => {
    buttons.set("a", makeButton("task-completed"));
    const d = dispatcher();
    d.handleRoute("/event/task-completed");
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
    // Visual flash still fires.
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });
});
