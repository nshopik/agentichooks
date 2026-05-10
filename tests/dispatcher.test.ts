import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Dispatcher } from "../src/dispatcher.js";
import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_FLASH_SETTINGS,
  type ButtonState,
  type EventType,
  type FlashSettings,
  type GlobalSettings,
} from "../src/types.js";
import type { DispatchableButton, DispatcherTaskCounter } from "../src/dispatcher.js";

type FakeButton = {
  eventType: EventType;
  settings: FlashSettings;
  state: ButtonState;
  alert: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
};

function makeButton(eventType: EventType, alerting = false): FakeButton {
  const btn: FakeButton = {
    eventType,
    settings: { ...DEFAULT_FLASH_SETTINGS },
    state: { alerting, pulseFrame: 0 },
    alert: vi.fn(),
    dismiss: vi.fn(),
  };
  // Keep the alerting bit in sync with what EventFlashAction would do, so the
  // dispatcher's behaviour reflects reality across re-fires within a test.
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
    audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
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
    d.fireTaskCompleted();
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

  it("/event/task-completed clears pending permission and decrements counter; no direct alert", () => {
    buttons.set("perm", makeButton("permission"));
    buttons.set("task", makeButton("task-completed"));
    const counter = { increment: vi.fn(), decrement: vi.fn(), reset: vi.fn() };
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/task-completed");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();
    // Direct alert is gone — task-completed never reaches the button via the
    // matrix anymore; arming is the counter's job at zero-reached.
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
    expect(counter.decrement).toHaveBeenCalledTimes(1);
  });

  it("/event/permission-request does not clear stop or task-completed", () => {
    buttons.set("stop", makeButton("stop"));
    buttons.set("task", makeButton("task-completed"));
    buttons.set("perm", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/stop");
    // task-completed alert is now armed via fireTaskCompleted (counter→zero path).
    d.fireTaskCompleted();
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
    d.fireTaskCompleted();
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
    d.fireTaskCompleted();
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

  it("session-end cancels all pending alerts", () => {
    buttons.set("stop", makeButton("stop"));
    buttons.set("perm", makeButton("permission"));
    buttons.set("task", makeButton("task-completed"));
    const d = dispatcher();
    d.handleRoute("/event/stop");
    d.handleRoute("/event/permission-request");
    d.fireTaskCompleted();
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/session-end");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("session-end dismisses already-armed buttons too", () => {
    buttons.set("stop", makeButton("stop", true));
    buttons.set("perm", makeButton("permission", true));
    buttons.set("task", makeButton("task-completed", true));
    const d = dispatcher();
    d.handleRoute("/event/session-end");
    expect(buttons.get("stop")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("task")!.dismiss).toHaveBeenCalledTimes(1);
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
    // task-completed alert is now armed via fireTaskCompleted (counter→zero path).
    d.fireTaskCompleted();
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

describe("Dispatcher.armedMsAgo — survives button rebuild on page/profile switch", () => {
  it("returns null when nothing has been armed", () => {
    const d = dispatcher();
    expect(d.armedMsAgo("permission")).toBeNull();
    expect(d.armedMsAgo("stop")).toBeNull();
    expect(d.armedMsAgo("task-completed")).toBeNull();
  });

  it("returns null while pending (delay timer not yet elapsed)", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(500);
    expect(d.armedMsAgo("permission")).toBeNull();
  });

  it("returns elapsed ms after fire, regardless of whether buttons are still in the map", () => {
    vi.setSystemTime(new Date("2026-05-09T00:00:00Z"));
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(1000); // fire at t=1000
    // Simulate Stream Deck page switch: button context is torn down.
    buttons.clear();
    vi.advanceTimersByTime(7000); // user reads email, comes back 7s later
    expect(d.armedMsAgo("permission")).toBe(7000);
  });

  it("clearType wipes armed state even if the alerting button was off-page", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(1000);
    // Page switched away — buttons disappeared.
    buttons.clear();
    // Then a clearing route arrives (post-tool-use).
    d.handleRoute("/event/post-tool-use");
    expect(d.armedMsAgo("permission")).toBeNull();
  });

  it("session-start clears armedMsAgo for every armed type", () => {
    buttons.set("s", makeButton("stop"));
    buttons.set("p", makeButton("permission"));
    globals.alertDelay.stop = 0;
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    d.handleRoute("/event/stop");
    d.handleRoute("/event/permission-request");
    expect(d.armedMsAgo("stop")).not.toBeNull();
    expect(d.armedMsAgo("permission")).not.toBeNull();
    d.handleRoute("/event/session-start");
    expect(d.armedMsAgo("stop")).toBeNull();
    expect(d.armedMsAgo("permission")).toBeNull();
    expect(d.armedMsAgo("task-completed")).toBeNull();
  });

  it("re-fire on already-armed type refreshes the timestamp", () => {
    vi.setSystemTime(new Date("2026-05-09T00:00:00Z"));
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(1000); // first fire at t=1000
    vi.advanceTimersByTime(3000); // t=4000, msAgo=3000
    expect(d.armedMsAgo("permission")).toBe(3000);
    d.handleRoute("/event/permission-request"); // re-fire (already armed) → resets timestamp
    expect(d.armedMsAgo("permission")).toBe(0);
  });
});

describe("Dispatcher.handleRoute — audio behavior preserved", () => {
  it("plays the configured soundPath at fire time", () => {
    globals.audio.permission.soundPath = "C:\\custom\\alert.wav";
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).toHaveBeenCalledWith("C:\\custom\\alert.wav");
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
    // task-completed fires via fireTaskCompleted (counter→zero), not via the route directly.
    d.fireTaskCompleted();
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
    // Visual flash still fires.
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });

  it("plays the configured soundPath for task-completed when set (no default exists)", () => {
    globals.audio["task-completed"].soundPath = "C:\\custom\\done.wav";
    buttons.set("a", makeButton("task-completed"));
    const d = dispatcher();
    // task-completed fires via fireTaskCompleted (counter→zero), not via the route directly.
    d.fireTaskCompleted();
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).toHaveBeenCalledWith("C:\\custom\\done.wav");
  });

  it("skips audio when task-completed soundPath is the empty string (explicit mute)", () => {
    globals.audio["task-completed"].soundPath = "";
    buttons.set("a", makeButton("task-completed"));
    const d = dispatcher();
    // task-completed fires via fireTaskCompleted (counter→zero), not via the route directly.
    d.fireTaskCompleted();
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });
});

describe("Dispatcher.handleRoute — counter directives", () => {
  function fakeCounter(): DispatcherTaskCounter & { increment: ReturnType<typeof vi.fn>; decrement: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn> } {
    return {
      increment: vi.fn(),
      decrement: vi.fn(),
      reset: vi.fn(),
    };
  }

  it("calls counter.increment for /event/task-created", () => {
    const counter = fakeCounter();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    d.handleRoute("/event/task-created");
    expect(counter.increment).toHaveBeenCalledTimes(1);
    expect(counter.decrement).not.toHaveBeenCalled();
    expect(counter.reset).not.toHaveBeenCalled();
  });

  it("counter directives are no-ops when no taskCounter opt is supplied", () => {
    // Existing tests construct dispatcher without taskCounter; this asserts
    // the new task-created route is a safe no-op when the counter isn't wired.
    const d = dispatcher();
    expect(() => d.handleRoute("/event/task-created")).not.toThrow();
  });

  it("fireTaskCompleted arms the task-completed alert after the configured delay", () => {
    buttons.set("task", makeButton("task-completed"));
    const d = dispatcher();
    d.fireTaskCompleted();
    vi.advanceTimersByTime(999);
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(buttons.get("task")!.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — counter wiring on session/prompt routes", () => {
  function fakeCounter() {
    return {
      increment: vi.fn(),
      decrement: vi.fn(),
      reset: vi.fn(),
    };
  }

  it("/event/session-start calls counter.reset after applying its existing clears", () => {
    buttons.set("perm", makeButton("permission", true));
    const counter = fakeCounter();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    d.handleRoute("/event/session-start");
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalled();
    expect(counter.reset).toHaveBeenCalledTimes(1);
  });

  it("/event/user-prompt-submit does NOT call counter.reset (regression guard)", () => {
    const counter = fakeCounter();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    d.handleRoute("/event/user-prompt-submit");
    expect(counter.reset).not.toHaveBeenCalled();
    expect(counter.increment).not.toHaveBeenCalled();
    expect(counter.decrement).not.toHaveBeenCalled();
  });

  it("/event/session-end calls counter.reset after applying its existing clears", () => {
    buttons.set("perm", makeButton("permission", true));
    const counter = fakeCounter();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    d.handleRoute("/event/session-end");
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalled();
    expect(counter.reset).toHaveBeenCalledTimes(1);
  });

  it("/event/task-completed does not directly arm the task-completed alert", () => {
    buttons.set("task", makeButton("task-completed"));
    const counter = fakeCounter();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    d.handleRoute("/event/task-completed");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
    expect(counter.decrement).toHaveBeenCalledTimes(1);
  });

  it("/event/task-created dismisses an active task-completed alert and increments counter", () => {
    // Reproduces the cosmetic UX gap: count → 0 fires the alert, then a fresh
    // task-created arrives. Without the cross-clear, the in-flight count visual
    // (state-0 image) is queued but invisible behind the alert image until the
    // 30s auto-timeout. With the cross-clear, the alert dismisses immediately
    // and the new count shows.
    const armedTask = makeButton("task-completed", true);
    buttons.set("task", armedTask);
    const counter = fakeCounter();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    d.handleRoute("/event/task-created");
    expect(armedTask.dismiss).toHaveBeenCalledTimes(1);
    expect(counter.increment).toHaveBeenCalledTimes(1);
  });

  it("/event/task-created cancels a pending task-completed alert in the pre-fire delay window", () => {
    // Variant of the above: task-created arrives during the 1s armType delay,
    // before fire() ran. Pending timer must be cancelled so the alert never
    // visually fires.
    buttons.set("task", makeButton("task-completed"));
    const counter = fakeCounter();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    // Simulate the pending alert by calling fireTaskCompleted (enters PENDING).
    d.fireTaskCompleted();
    vi.advanceTimersByTime(500); // half the 1s delay
    d.handleRoute("/event/task-created");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
    expect(counter.increment).toHaveBeenCalledTimes(1);
  });
});
