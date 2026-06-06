import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Dispatcher, deriveRoute } from "../src/dispatcher.js";
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
  alert: ReturnType<typeof vi.fn<() => void>>;
  dismiss: ReturnType<typeof vi.fn<() => void>>;
};

function makeButton(eventType: EventType, alerting = false): FakeButton {
  const btn: FakeButton = {
    eventType,
    settings: { ...DEFAULT_FLASH_SETTINGS },
    state: { alerting, pulseFrame: 0 },
    alert: vi.fn<() => void>(),
    dismiss: vi.fn<() => void>(),
  };
  // Keep the alerting bit in sync with what EventFlashAction would do, so the
  // dispatcher's behaviour reflects reality across re-fires within a test.
  btn.alert.mockImplementation(() => { btn.state.alerting = true; });
  btn.dismiss.mockImplementation(() => { btn.state.alerting = false; });
  return btn;
}

// Single typed counter fake shared by every describe block (previously three
// local copies, one of them untyped).
function fakeCounter(): DispatcherTaskCounter & {
  increment: ReturnType<typeof vi.fn<() => void>>;
  decrement: ReturnType<typeof vi.fn<() => void>>;
  reset: ReturnType<typeof vi.fn<() => void>>;
} {
  return {
    increment: vi.fn<() => void>(),
    decrement: vi.fn<() => void>(),
    reset: vi.fn<() => void>(),
  };
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
    const counter = fakeCounter();
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
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
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

describe("Dispatcher.handleRoute — ARMED → clear → re-arm lifecycle", () => {
  it("re-arm after a route-based clear goes through the PENDING delay and fires exactly once", () => {
    const btn = makeButton("permission");
    buttons.set("perm", btn);
    const d = dispatcher();
    d.handleRoute("/event/permission-request");
    vi.advanceTimersByTime(1000); // fire #1 → ARMED
    expect(btn.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);

    d.handleRoute("/event/post-tool-use"); // clears permission → IDLE
    expect(btn.dismiss).toHaveBeenCalledTimes(1);

    d.handleRoute("/event/permission-request"); // re-arm → PENDING, not instant
    vi.advanceTimersByTime(999);
    expect(btn.alert).toHaveBeenCalledTimes(1); // not yet
    vi.advanceTimersByTime(1);
    expect(btn.alert).toHaveBeenCalledTimes(2); // exactly one new alert
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000); // no stray timer left behind
    expect(btn.alert).toHaveBeenCalledTimes(2);
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
  });
});

describe("Dispatcher.handleRoute — ARMED + zero-delay precedence", () => {
  it("with delay=0, a same-type arm on an ARMED slot re-fires immediately without entering PENDING", () => {
    globals.alertDelay.permission = 0;
    const btn = makeButton("permission");
    buttons.set("perm", btn);
    const d = dispatcher();
    d.handleRoute("/event/permission-request"); // fire #1 → ARMED, no timer
    expect(btn.alert).toHaveBeenCalledTimes(1);
    d.handleRoute("/event/permission-request"); // ARMED check wins; immediate re-fire
    expect(btn.dismiss).toHaveBeenCalledTimes(1); // re-fire dismisses the prior alert first
    expect(btn.alert).toHaveBeenCalledTimes(2);
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
    // No PENDING state was ever created — advancing timers changes nothing.
    vi.advanceTimersByTime(10_000);
    expect(btn.alert).toHaveBeenCalledTimes(2);
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
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

describe("deriveRoute — pure route derivation", () => {
  it("passes through any route that is not /event/session-start regardless of source", () => {
    expect(deriveRoute("/event/stop", undefined, undefined, "s")).toBe("/event/stop");
    expect(deriveRoute("/event/stop", "compact", undefined, "s")).toBe("/event/stop");
    expect(deriveRoute("/event/permission-request", "resume", undefined, "s")).toBe("/event/permission-request");
    expect(deriveRoute("/event/user-prompt-submit", "startup", undefined, "s")).toBe("/event/user-prompt-submit");
    expect(deriveRoute("/event/task-created", undefined, undefined, "s")).toBe("/event/task-created");
  });

  it("passes through /event/session-start for source=startup", () => {
    expect(deriveRoute("/event/session-start", "startup", undefined, "s")).toBe("/event/session-start");
  });

  it("passes through /event/session-start for source=clear", () => {
    expect(deriveRoute("/event/session-start", "clear", undefined, "s")).toBe("/event/session-start");
  });

  it("passes through /event/session-start for source=undefined (missing body)", () => {
    expect(deriveRoute("/event/session-start", undefined, undefined, "s")).toBe("/event/session-start");
  });

  it("passes through /event/session-start for an unknown future source value", () => {
    expect(deriveRoute("/event/session-start", "rewind", undefined, "s")).toBe("/event/session-start");
  });

  it("returns /event/session-start-soft for source=compact", () => {
    expect(deriveRoute("/event/session-start", "compact", undefined, "s")).toBe("/event/session-start-soft");
  });

  it("returns /event/session-start-soft for source=resume", () => {
    expect(deriveRoute("/event/session-start", "resume", undefined, "s")).toBe("/event/session-start-soft");
  });
});

describe("deriveRoute — agent-context drop policy", () => {
  // The 12 action routes below mirror http-listener.ts's ACTION_ROUTES (not exported).
  // This list must stay in sync with that set; any divergence means a route either
  // silently drops for agentId-present bodies (over-filtering) or silently passes
  // through (under-filtering) — both are bugs.
  const ACTION_ROUTES = [
    "/event/stop",
    "/event/stop-failure",
    "/event/permission-request",
    "/event/task-completed",
    "/event/task-created",
    "/event/session-start",
    "/event/user-prompt-submit",
    "/event/permission-denied",
    "/event/post-tool-use",
    "/event/post-tool-use-failure",
    "/event/pre-tool-use",
    "/event/session-end",
  ];

  const DROP_ROUTES = [
    "/event/stop",
    "/event/stop-failure",
    "/event/permission-request",
    "/event/user-prompt-submit",
    "/event/session-start",
    "/event/session-end",
    "/event/pre-tool-use",
    "/event/post-tool-use",
    "/event/post-tool-use-failure",
    "/event/permission-denied",
  ];

  it("returns null for every drop-policy route when agentId is present", () => {
    for (const route of DROP_ROUTES) {
      expect(deriveRoute(route, undefined, "agt-001", "s")).toBeNull();
      expect(deriveRoute(route, "compact", "agt-001", "s")).toBeNull();
    }
  });

  it("returns the route itself for /event/task-created with agentId (passthrough)", () => {
    expect(deriveRoute("/event/task-created", undefined, "agt-001", "s")).toBe("/event/task-created");
  });

  it("returns /event/task-completed-agent for /event/task-completed with agentId", () => {
    expect(deriveRoute("/event/task-completed", undefined, "agt-001", "s")).toBe("/event/task-completed-agent");
    expect(deriveRoute("/event/task-completed", "compact", "agt-001", "s")).toBe("/event/task-completed-agent");
  });

  it("agent check wins over source logic: agentId + source=compact on session-start → null", () => {
    // Precedence: agent check is evaluated FIRST; source logic only runs in the
    // agentId-absent branch. A compact-resume session-start from an agent context
    // still drops (null), not the soft route.
    expect(deriveRoute("/event/session-start", "compact", "agt-001", "s")).toBeNull();
    expect(deriveRoute("/event/session-start", "resume", "agt-001", "s")).toBeNull();
  });

  it("never returns null for any ACTION_ROUTES member when agentId is absent and sessionId is present (backwards-compat pin)", () => {
    // The invariant: absent agentId never drops — *when a valid sessionId is present*.
    // The session gate (added in 0.9.x) makes the old 2/3-arg form intentionally null for all 12 routes;
    // the new invariant is conditional on sessionId being a non-empty string.
    for (const route of ACTION_ROUTES) {
      const result = deriveRoute(route, undefined, undefined, "sess-abc123");
      expect(result).not.toBeNull();
    }
  });
});

describe("deriveRoute — session-id gate (evaluated before agent-context check)", () => {
  // The 12 action routes below mirror http-listener.ts's ACTION_ROUTES.
  const ACTION_ROUTES = [
    "/event/stop",
    "/event/stop-failure",
    "/event/permission-request",
    "/event/task-completed",
    "/event/task-created",
    "/event/session-start",
    "/event/user-prompt-submit",
    "/event/permission-denied",
    "/event/post-tool-use",
    "/event/post-tool-use-failure",
    "/event/pre-tool-use",
    "/event/session-end",
  ];

  it("returns null for every action route when sessionId is undefined", () => {
    for (const route of ACTION_ROUTES) {
      expect(deriveRoute(route, undefined, undefined, undefined)).toBeNull();
    }
  });

  it("returns null for every action route when sessionId is empty string", () => {
    for (const route of ACTION_ROUTES) {
      expect(deriveRoute(route, undefined, undefined, "")).toBeNull();
    }
  });

  it("returns non-null for every action route when sessionId is a non-empty string", () => {
    for (const route of ACTION_ROUTES) {
      // source=undefined, agentId=undefined — pure session gate, no other policy applies
      const result = deriveRoute(route, undefined, undefined, "sess-abc123");
      expect(result).not.toBeNull();
    }
  });

  it("session gate precedes agent check: agentId present + no sessionId → null, not agent-passthrough", () => {
    // If the agent check ran first, task-created would return the route (passthrough).
    // If the session gate runs first, undefined sessionId → null regardless of agentId.
    expect(deriveRoute("/event/task-created", undefined, "agt-001", undefined)).toBeNull();
    expect(deriveRoute("/event/task-created", undefined, "agt-001", "")).toBeNull();
    // With a sessionId, the agent check runs normally.
    expect(deriveRoute("/event/task-created", undefined, "agt-001", "sess-xyz")).toBe("/event/task-created");
  });

  it("session gate precedes agent check: agentId present + no sessionId → null for drop-policy routes too", () => {
    expect(deriveRoute("/event/stop", undefined, "agt-001", undefined)).toBeNull();
    expect(deriveRoute("/event/permission-request", "compact", "agt-001", "")).toBeNull();
  });

  it("all existing source/agent permutations are preserved when sessionId is present", () => {
    // Source logic: session-start + compact/resume → soft route
    expect(deriveRoute("/event/session-start", "compact", undefined, "s")).toBe("/event/session-start-soft");
    expect(deriveRoute("/event/session-start", "resume", undefined, "s")).toBe("/event/session-start-soft");
    expect(deriveRoute("/event/session-start", "startup", undefined, "s")).toBe("/event/session-start");
    expect(deriveRoute("/event/session-start", undefined, undefined, "s")).toBe("/event/session-start");
    // Agent logic: task-created passthrough, task-completed → agent row, others → null
    expect(deriveRoute("/event/task-created", undefined, "agt-001", "s")).toBe("/event/task-created");
    expect(deriveRoute("/event/task-completed", undefined, "agt-001", "s")).toBe("/event/task-completed-agent");
    expect(deriveRoute("/event/stop", undefined, "agt-001", "s")).toBeNull();
  });
});

describe("deriveRoute invariant — every emission is a known matrix key", () => {
  // Drift insurance: if the SESSION_START_SOFT constant and the ROUTES matrix
  // row ever diverge, the soft route falls into handleRoute's `unknown route=`
  // debug path and silently becomes a no-op "for the wrong reason". An injected
  // log stub is the ONLY observable that distinguishes "found in ROUTES" from
  // "unknown route" — every behavioral signal (counter calls, dismisses, PENDING
  // timers) is identical for both states, because the soft row is {clears: []}.
  it("every deriveRoute emission for session-start is a known ROUTES key (no `unknown route` log)", () => {
    const debug = vi.fn<(msg: string) => void>();
    const log = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      log,
    });
    for (const source of ["startup", "clear", "compact", "resume", undefined, "rewind"]) {
      const derived = deriveRoute("/event/session-start", source, undefined, "s");
      if (derived !== null) d.handleRoute(derived);
    }
    expect(debug.mock.calls.flat().some((m) => String(m).includes("unknown route="))).toBe(false);
  });

  it("handleRoute(/event/session-start-soft) makes zero counter calls and leaves ARMED state intact", () => {
    buttons.set("perm", makeButton("permission"));
    const counter = fakeCounter();
    globals.alertDelay.permission = 0; // permission fires immediately on arm
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    d.handleRoute("/event/permission-request"); // delay=0 → fires → ARMED (makeButton's
    // alert mock sets state.alerting = true, mirroring the real action)
    // Fire the soft route.
    d.handleRoute("/event/session-start-soft");
    // Zero counter calls.
    expect(counter.increment).not.toHaveBeenCalled();
    expect(counter.decrement).not.toHaveBeenCalled();
    expect(counter.reset).not.toHaveBeenCalled();
    // ARMED permission is NOT dismissed (clears: []).
    expect(buttons.get("perm")!.dismiss).not.toHaveBeenCalled();
    // Contrast: the hard route DOES dismiss it.
    d.handleRoute("/event/session-start");
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
  });

  it("handleRoute(TASK_COMPLETED_AGENT derived route) never logs 'unknown route=' (synthetic row is in ROUTES)", () => {
    // The TASK_COMPLETED_AGENT row is { clears: [], counter: "decrement" } — behaviorally
    // identical to an unknown route (no arms, no clears). An injected log stub is the ONLY
    // observable that distinguishes "row found" from "unknown route" for this shape.
    // This mirrors the SESSION_START_SOFT invariant test pattern exactly.
    const debug = vi.fn<(msg: string) => void>();
    const log = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const counter = fakeCounter();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      log,
      taskCounter: counter,
    });
    const derived = deriveRoute("/event/task-completed", undefined, "agt-001", "s");
    expect(derived).not.toBeNull();
    d.handleRoute(derived!);
    expect(debug.mock.calls.flat().some((m) => String(m).includes("unknown route="))).toBe(false);
    // Decrement was called — the row was found and applied (not silently dropped).
    expect(counter.decrement).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — TASK_COMPLETED_AGENT synthetic row (agent-context task-completed)", () => {
  it("handleRoute(TASK_COMPLETED_AGENT) decrements the counter exactly once", () => {
    const counter = fakeCounter();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    // Drive via deriveRoute to use the same path as production.
    const derived = deriveRoute("/event/task-completed", undefined, "agt-001", "s");
    expect(derived).not.toBeNull();
    d.handleRoute(derived!);
    expect(counter.decrement).toHaveBeenCalledTimes(1);
    expect(counter.increment).not.toHaveBeenCalled();
    expect(counter.reset).not.toHaveBeenCalled();
  });

  it("handleRoute(TASK_COMPLETED_AGENT) does NOT clear an armed permission alert (regression guard)", () => {
    // Bug repro: the normal /event/task-completed row has clears: ["permission"],
    // which dismisses a legitimate permission alert when a teammate completes a task.
    // The agent-context synthetic row must have clears: [] to avoid this.
    const counter = fakeCounter();
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0; // fires immediately
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    d.handleRoute("/event/permission-request"); // arms permission (delay=0 → ARMED immediately)
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);

    // Teammate task-completed arrives with agentId.
    const derived = deriveRoute("/event/task-completed", undefined, "agt-teammate", "s");
    expect(derived).not.toBeNull();
    d.handleRoute(derived!);

    // Permission is still ARMED — not cleared.
    expect(buttons.get("perm")!.dismiss).not.toHaveBeenCalled();
    expect(d.armedMsAgo("permission")).not.toBeNull();
    expect(counter.decrement).toHaveBeenCalledTimes(1);
  });

  it("contrast: normal /event/task-completed DOES clear an armed permission alert", () => {
    // Confirms the two rows behave differently — the normal row's clears: ["permission"]
    // is intentional (permission was resolved); the agent row must not have it.
    const counter = fakeCounter();
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0;
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    d.handleRoute("/event/permission-request");
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);

    d.handleRoute("/event/task-completed"); // normal row, no agentId
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
    expect(d.armedMsAgo("permission")).toBeNull();
  });
});

describe("deriveRoute bug-repro regression — hard vs soft session-start counter behavior", () => {
  it("hard session-start calls counter.reset; soft session-start-soft does not", () => {
    const counter = fakeCounter();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      taskCounter: counter,
    });
    // Simulate three increments (in-flight subagents).
    d.handleRoute("/event/task-created");
    d.handleRoute("/event/task-created");
    d.handleRoute("/event/task-created");
    expect(counter.increment).toHaveBeenCalledTimes(3);

    // A compact/resume fires the soft route — must not reset.
    const softRoute = deriveRoute("/event/session-start", "compact", undefined, "s");
    if (softRoute !== null) d.handleRoute(softRoute);
    expect(counter.reset).not.toHaveBeenCalled();

    // A genuine new session fires the hard route — must reset.
    const hardRoute = deriveRoute("/event/session-start", "startup", undefined, "s");
    if (hardRoute !== null) d.handleRoute(hardRoute);
    expect(counter.reset).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.dismissArmed — type-wide dismiss seam", () => {
  // (1) dismissArmed on an ARMED type → armedMsAgo null + alerting buttons dismissed.
  it("dismissArmed on ARMED type clears armedMsAgo and dismisses alerting buttons of that type", () => {
    globals.alertDelay.permission = 0; // fires immediately → ARMED
    const btn = makeButton("permission");
    buttons.set("perm", btn);
    const d = dispatcher();
    d.handleRoute("/event/permission-request"); // delay=0 → ARMED, btn.alert called
    expect(d.armedMsAgo("permission")).not.toBeNull();
    expect(btn.alert).toHaveBeenCalledTimes(1);

    d.dismissArmed("permission");

    expect(d.armedMsAgo("permission")).toBeNull();
    expect(btn.dismiss).toHaveBeenCalledTimes(1);
  });

  // (2) dismissArmed on IDLE type with no alerting buttons → no state change, no dismiss calls, no throw.
  it("dismissArmed on IDLE type with no alerting buttons is a safe no-op", () => {
    const btn = makeButton("stop"); // not alerting
    buttons.set("stop", btn);
    const d = dispatcher();
    // stop is IDLE — never armed
    expect(() => d.dismissArmed("stop")).not.toThrow();
    expect(d.armedMsAgo("stop")).toBeNull();
    expect(btn.dismiss).not.toHaveBeenCalled();
  });

  // (3) dismissArmed during PENDING cancels the timer — advance fake timers past the delay, assert no fire.
  it("dismissArmed during PENDING cancels the pending timer — no audio, no alert after delay", () => {
    const btn = makeButton("permission");
    buttons.set("perm", btn);
    const d = dispatcher();
    d.handleRoute("/event/permission-request"); // default 1s delay → PENDING
    vi.advanceTimersByTime(500);
    expect(btn.alert).not.toHaveBeenCalled();

    d.dismissArmed("permission");

    // Advance well past the original delay — timer must not fire.
    vi.advanceTimersByTime(5000);
    expect(btn.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
    expect(d.armedMsAgo("permission")).toBeNull();
  });

  // (4) Re-arm after dismissArmed goes through the PENDING delay window, not instant fire.
  it("re-arm after dismissArmed goes through the normal PENDING delay, not instant fire", () => {
    globals.alertDelay.permission = 0; // fires immediately → ARMED
    const btn = makeButton("permission");
    buttons.set("perm", btn);
    const d = dispatcher();
    d.handleRoute("/event/permission-request"); // ARMED immediately
    d.dismissArmed("permission"); // → IDLE

    // Restore normal delay for the re-arm.
    globals.alertDelay.permission = 1000;
    d.handleRoute("/event/permission-request"); // must re-enter PENDING, not fire instantly

    // At 999ms: not yet fired.
    vi.advanceTimersByTime(999);
    expect(btn.alert).toHaveBeenCalledTimes(1); // only the initial fire before dismissArmed
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);

    // At 1000ms: fires once more.
    vi.advanceTimersByTime(1);
    expect(btn.alert).toHaveBeenCalledTimes(2);
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
  });

  // (5) Cross-type non-interference: dismissArmed("stop") leaves PENDING and ARMED state of "permission" untouched.
  it("dismissArmed(stop) leaves PENDING permission untouched", () => {
    const stopBtn = makeButton("stop");
    const permBtn = makeButton("permission");
    buttons.set("stop", stopBtn);
    buttons.set("perm", permBtn);
    globals.alertDelay.stop = 0; // stop fires immediately → ARMED
    const d = dispatcher();
    d.handleRoute("/event/stop"); // ARMED immediately
    d.handleRoute("/event/permission-request"); // 1s delay → PENDING

    d.dismissArmed("stop"); // must not touch permission

    // Advance past permission's delay — it must still fire.
    vi.advanceTimersByTime(1000);
    expect(permBtn.alert).toHaveBeenCalledTimes(1);
    expect(d.armedMsAgo("permission")).not.toBeNull();
    // Stop was cleared.
    expect(d.armedMsAgo("stop")).toBeNull();
    expect(stopBtn.dismiss).toHaveBeenCalledTimes(1);
  });

  it("dismissArmed(stop) leaves an ARMED permission untouched", () => {
    globals.alertDelay.stop = 0;
    globals.alertDelay.permission = 0;
    const stopBtn = makeButton("stop");
    const permBtn = makeButton("permission");
    buttons.set("stop", stopBtn);
    buttons.set("perm", permBtn);
    const d = dispatcher();
    d.handleRoute("/event/stop"); // ARMED
    d.handleRoute("/event/permission-request"); // ARMED

    d.dismissArmed("stop");

    expect(d.armedMsAgo("stop")).toBeNull();
    expect(stopBtn.dismiss).toHaveBeenCalledTimes(1);
    // permission stays armed
    expect(d.armedMsAgo("permission")).not.toBeNull();
    expect(permBtn.dismiss).not.toHaveBeenCalled();
  });
});
