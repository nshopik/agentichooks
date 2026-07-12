import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Dispatcher, deriveRoute, STOP_SAFETY_RELEASE_MS, STOP_SETTLE_MS } from "../src/dispatcher.js";
import { ACTION_ROUTES as ACTION_ROUTES_EXPORT } from "../src/http-listener.js";
import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_FLASH_SETTINGS,
  type ButtonState,
  type EventType,
  type FlashSettings,
  type GlobalSettings,
} from "../src/types.js";
import type { DispatchableButton, DispatcherCounter } from "../src/dispatcher.js";
import { SessionSetCounter } from "../src/session-set-counter.js";

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

// Three-slot counter fake matching DispatcherOpts.counters shape.
function fakeCounters(): {
  tasks: DispatcherCounter & {
    add: ReturnType<typeof vi.fn<(sessionId: string, id: string) => void>>;
    remove: ReturnType<typeof vi.fn<(sessionId: string, id: string) => void>>;
    reset: ReturnType<typeof vi.fn<(sessionId: string) => void>>;
    has: ReturnType<typeof vi.fn<(sessionId: string) => boolean>>;
  };
  subagents: DispatcherCounter & {
    add: ReturnType<typeof vi.fn<(sessionId: string, id: string) => void>>;
    remove: ReturnType<typeof vi.fn<(sessionId: string, id: string) => void>>;
    reset: ReturnType<typeof vi.fn<(sessionId: string) => void>>;
    has: ReturnType<typeof vi.fn<(sessionId: string) => boolean>>;
  };
  thinking: DispatcherCounter & {
    add: ReturnType<typeof vi.fn<(sessionId: string, id: string) => void>>;
    remove: ReturnType<typeof vi.fn<(sessionId: string, id: string) => void>>;
    reset: ReturnType<typeof vi.fn<(sessionId: string) => void>>;
    has: ReturnType<typeof vi.fn<(sessionId: string) => boolean>>;
  };
} {
  const make = () => ({
    add: vi.fn<(sessionId: string, id: string) => void>(),
    remove: vi.fn<(sessionId: string, id: string) => void>(),
    reset: vi.fn<(sessionId: string) => void>(),
    // Default: no subagents in flight. Tests that exercise stop-suppression
    // override subagents.has per-case.
    has: vi.fn<(sessionId: string) => boolean>(() => false),
  });
  return { tasks: make(), subagents: make(), thinking: make() };
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
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(999);
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("fires audio + alert exactly when the delay elapses", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(1000);
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("uses the per-event-type delay configured in globals", () => {
    globals.alertDelay.stop = 5000;
    buttons.set("a", makeButton("stop"));
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-test");
    vi.advanceTimersByTime(4999);
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — stop settle window floor", () => {
  it("a fresh stop-arm pends max(alertDelay.stop, STOP_SETTLE_MS) even when alertDelay.stop is smaller", () => {
    globals.alertDelay.stop = 500; // configured delay well under the floor
    buttons.set("stop", makeButton("stop"));
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-test");
    vi.advanceTimersByTime(STOP_SETTLE_MS - 1);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("permission and task-completed keep the bare alertDelay — the settle floor is stop-only", () => {
    globals.alertDelay.permission = 500;
    globals.alertDelay["task-completed"] = 500;
    buttons.set("perm", makeButton("permission"));
    buttons.set("task", makeButton("task-completed"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    d.fireTaskCompleted("sess-test");
    vi.advanceTimersByTime(500);
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);
    expect(buttons.get("task")!.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — pending cancelled by clearing route (the bug fix)", () => {
  it("permission-request followed by post-tool-use within delay → no audio, no alert", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/post-tool-use", "sess-test");
    vi.advanceTimersByTime(5000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
  });

  it("permission-denied also cancels a pending permission alert", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/permission-denied", "sess-test");
    vi.advanceTimersByTime(5000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("post-tool-use-failure also cancels a pending permission alert", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/post-tool-use-failure", "sess-test");
    vi.advanceTimersByTime(5000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });
});

describe("Dispatcher.handleRoute — same-type arm during PENDING is no-op (no timer extension)", () => {
  it("two permission-requests 500ms apart fire exactly one alert at t=1000", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/permission-request", "sess-test");
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
    d.handleRoute("/event/permission-request", "sess-test");
    d.fireTaskCompleted("sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/stop", "sess-test");
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
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/stop-failure", "sess-test");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
  });

  it("/event/task-completed clears pending permission and decrements tasks counter; no direct alert", () => {
    buttons.set("perm", makeButton("permission"));
    buttons.set("task", makeButton("task-completed"));
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/task-completed", "sess-test", { taskId: "task-001" });
    vi.advanceTimersByTime(5000);
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();
    // Direct alert is gone — task-completed never reaches the button via the
    // matrix anymore; arming is the counter's job at zero-reached.
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
    expect(counters.tasks.remove).toHaveBeenCalledTimes(1);
    expect(counters.tasks.remove).toHaveBeenCalledWith("sess-test", "task-001");
  });

  it("/event/permission-request does not clear stop or task-completed", () => {
    buttons.set("stop", makeButton("stop"));
    buttons.set("task", makeButton("task-completed"));
    buttons.set("perm", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-test");
    // task-completed alert is now armed via fireTaskCompleted (counter→zero path).
    d.fireTaskCompleted("sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/permission-request", "sess-test");
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
    d.handleRoute("/event/stop", "sess-test");
    d.handleRoute("/event/permission-request", "sess-test");
    d.fireTaskCompleted("sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/session-start", "sess-test");
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
    d.handleRoute("/event/stop", "sess-test");
    d.handleRoute("/event/permission-request", "sess-test");
    d.fireTaskCompleted("sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/user-prompt-submit", "sess-test");
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
    d.handleRoute("/event/session-start", "sess-test");
    expect(buttons.get("stop")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
  });

  it("session-end cancels all pending alerts", () => {
    buttons.set("stop", makeButton("stop"));
    buttons.set("perm", makeButton("permission"));
    buttons.set("task", makeButton("task-completed"));
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-test");
    d.handleRoute("/event/permission-request", "sess-test");
    d.fireTaskCompleted("sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/session-end", "sess-test");
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
    d.handleRoute("/event/session-end", "sess-test");
    expect(buttons.get("stop")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
    expect(buttons.get("task")!.dismiss).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — re-fire when already ARMED", () => {
  it("same-type arm on an armed slot re-fires (audio plays twice)", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
    // Now ARMED. Another permission-request fires immediately, no fresh wait.
    d.handleRoute("/event/permission-request", "sess-test");
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
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(1000); // fire #1 → ARMED
    expect(btn.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);

    d.handleRoute("/event/post-tool-use", "sess-test"); // clears permission → IDLE
    expect(btn.dismiss).toHaveBeenCalledTimes(1);

    d.handleRoute("/event/permission-request", "sess-test"); // re-arm → PENDING, not instant
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
    d.handleRoute("/event/permission-request", "sess-test"); // fire #1 → ARMED, no timer
    expect(btn.alert).toHaveBeenCalledTimes(1);
    d.handleRoute("/event/permission-request", "sess-test"); // ARMED check wins; immediate re-fire
    expect(btn.dismiss).toHaveBeenCalledTimes(1); // re-fire dismisses the prior alert first
    expect(btn.alert).toHaveBeenCalledTimes(2);
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
    // No PENDING state was ever created — advancing timers changes nothing.
    vi.advanceTimersByTime(10_000);
    expect(btn.alert).toHaveBeenCalledTimes(2);
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
  });
});

describe("Dispatcher.handleRoute — pre-tool-use clears stop (agentic loop restart)", () => {
  it("pre-tool-use cancels a pending stop alert (loop restarted without user input)", () => {
    buttons.set("a", makeButton("stop"));
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/pre-tool-use", "sess-test");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("pre-tool-use dismisses an already-armed stop alert", () => {
    buttons.set("a", makeButton("stop", true));
    const d = dispatcher();
    d.handleRoute("/event/pre-tool-use", "sess-test");
    expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1);
  });

  it("pre-tool-use does not affect a pending permission", () => {
    buttons.set("perm", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/pre-tool-use", "sess-test");
    vi.advanceTimersByTime(2000);
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);
  });

  it("pre-tool-use does not affect a pending task-completed", () => {
    buttons.set("task", makeButton("task-completed"));
    const d = dispatcher();
    // task-completed alert is now armed via fireTaskCompleted (counter→zero path).
    d.fireTaskCompleted("sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/pre-tool-use", "sess-test");
    vi.advanceTimersByTime(2000);
    expect(buttons.get("task")!.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — info-only and unknown routes", () => {
  it("unknown route is a silent no-op — no counter calls, no dismisses, only the pending permission fires", () => {
    buttons.set("a", makeButton("permission"));
    const armedStop = makeButton("stop", true);
    buttons.set("s", armedStop);
    const counters = fakeCounters();
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
      log,
    });
    d.handleRoute("/event/permission-request", "sess-test"); // enters PENDING
    d.handleRoute("/event/this-does-not-exist", "sess-test", { taskId: "t1", agentId: "a1" });
    // No counter mutation of any kind leaked through the unknown route.
    for (const metric of [counters.tasks, counters.subagents, counters.thinking]) {
      expect(metric.add).not.toHaveBeenCalled();
      expect(metric.remove).not.toHaveBeenCalled();
      expect(metric.reset).not.toHaveBeenCalled();
    }
    // No dismiss leaked through either — the pre-armed stop stays armed.
    expect(armedStop.dismiss).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    // The pending permission still fires; the unknown route had no effect.
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });

  it("clearing route with no matching pending or armed state is a no-op", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/post-tool-use", "sess-test");
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
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(500);
    expect(d.armedMsAgo("permission")).toBeNull();
  });

  it("returns elapsed ms after fire, regardless of whether buttons are still in the map", () => {
    vi.setSystemTime(new Date("2026-05-09T00:00:00Z"));
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(1000); // fire at t=1000
    // Simulate Stream Deck page switch: button context is torn down.
    buttons.clear();
    vi.advanceTimersByTime(7000); // user reads email, comes back 7s later
    expect(d.armedMsAgo("permission")).toBe(7000);
  });

  it("clearType wipes armed state even if the alerting button was off-page", () => {
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(1000);
    // Page switched away — buttons disappeared.
    buttons.clear();
    // Then a clearing route arrives (post-tool-use).
    d.handleRoute("/event/post-tool-use", "sess-test");
    expect(d.armedMsAgo("permission")).toBeNull();
  });

  it("session-start clears armedMsAgo for every armed type", () => {
    buttons.set("s", makeButton("stop"));
    buttons.set("p", makeButton("permission"));
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-test");
    vi.advanceTimersByTime(STOP_SETTLE_MS); // stop always settles before arming
    d.handleRoute("/event/permission-request", "sess-test");
    expect(d.armedMsAgo("stop")).not.toBeNull();
    expect(d.armedMsAgo("permission")).not.toBeNull();
    d.handleRoute("/event/session-start", "sess-test");
    expect(d.armedMsAgo("stop")).toBeNull();
    expect(d.armedMsAgo("permission")).toBeNull();
    expect(d.armedMsAgo("task-completed")).toBeNull();
  });

  it("re-fire on already-armed type refreshes the timestamp", () => {
    vi.setSystemTime(new Date("2026-05-09T00:00:00Z"));
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(1000); // first fire at t=1000
    vi.advanceTimersByTime(3000); // t=4000, msAgo=3000
    expect(d.armedMsAgo("permission")).toBe(3000);
    d.handleRoute("/event/permission-request", "sess-test"); // re-fire (already armed) → resets timestamp
    expect(d.armedMsAgo("permission")).toBe(0);
  });
});

describe("Dispatcher.handleRoute — audio behavior preserved", () => {
  it("plays the configured soundPath at fire time", () => {
    globals.audio.permission.soundPath = "C:\\custom\\alert.wav";
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).toHaveBeenCalledWith("C:\\custom\\alert.wav");
  });

  it("skips audio when soundPath is the empty string (explicit mute)", () => {
    globals.audio.permission.soundPath = "";
    buttons.set("a", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
    // Visual still fires though.
    expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  });

  it("plays no sound for task-completed when soundPath is unset (no default)", () => {
    buttons.set("a", makeButton("task-completed"));
    const d = dispatcher();
    // task-completed fires via fireTaskCompleted (counter→zero), not via the route directly.
    d.fireTaskCompleted("sess-test");
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
    d.fireTaskCompleted("sess-test");
    vi.advanceTimersByTime(1000);
    expect(audioPlayer.play).toHaveBeenCalledWith("C:\\custom\\done.wav");
  });

});

describe("Dispatcher.handleRoute — counter directives", () => {
  it("calls counters.tasks.add for /event/task-created", () => {
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/task-created", "sess-test", { taskId: "task-1" });
    expect(counters.tasks.add).toHaveBeenCalledTimes(1);
    expect(counters.tasks.add).toHaveBeenCalledWith("sess-test", "task-1");
    expect(counters.tasks.remove).not.toHaveBeenCalled();
    expect(counters.tasks.reset).not.toHaveBeenCalled();
  });

  it("fireTaskCompleted arms the task-completed alert after the configured delay", () => {
    buttons.set("task", makeButton("task-completed"));
    const d = dispatcher();
    d.fireTaskCompleted("sess-test");
    vi.advanceTimersByTime(999);
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(buttons.get("task")!.alert).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — counter wiring on session/prompt routes", () => {
  it("/event/session-start calls counters.tasks.reset (and all slots) after applying its existing clears", () => {
    buttons.set("perm", makeButton("permission", true));
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/session-start", "sess-test");
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalled();
    expect(counters.tasks.reset).toHaveBeenCalledTimes(1);
    expect(counters.tasks.reset).toHaveBeenCalledWith("sess-test");
    expect(counters.subagents.reset).toHaveBeenCalledTimes(1);
    expect(counters.subagents.reset).toHaveBeenCalledWith("sess-test");
    expect(counters.thinking.reset).toHaveBeenCalledTimes(1);
    expect(counters.thinking.reset).toHaveBeenCalledWith("sess-test");
  });

  it("/event/user-prompt-submit does NOT call counters.tasks.reset (regression guard)", () => {
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/user-prompt-submit", "sess-test");
    expect(counters.tasks.reset).not.toHaveBeenCalled();
    expect(counters.tasks.add).not.toHaveBeenCalled();
    expect(counters.tasks.remove).not.toHaveBeenCalled();
  });

  it("/event/session-end calls counters.tasks.reset (and all slots) after applying its existing clears", () => {
    buttons.set("perm", makeButton("permission", true));
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/session-end", "sess-test");
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalled();
    expect(counters.tasks.reset).toHaveBeenCalledTimes(1);
    expect(counters.tasks.reset).toHaveBeenCalledWith("sess-test");
    expect(counters.subagents.reset).toHaveBeenCalledTimes(1);
    expect(counters.subagents.reset).toHaveBeenCalledWith("sess-test");
    expect(counters.thinking.reset).toHaveBeenCalledTimes(1);
    expect(counters.thinking.reset).toHaveBeenCalledWith("sess-test");
  });

  it("/event/task-created dismisses an active task-completed alert and increments counter", () => {
    // Reproduces the cosmetic UX gap: count → 0 fires the alert, then a fresh
    // task-created arrives. Without the cross-clear, the in-flight count visual
    // (state-0 image) is queued but invisible behind the alert image until the
    // 30s auto-timeout. With the cross-clear, the alert dismisses immediately
    // and the new count shows.
    const armedTask = makeButton("task-completed", true);
    buttons.set("task", armedTask);
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/task-created", "sess-test", { taskId: "task-1" });
    expect(armedTask.dismiss).toHaveBeenCalledTimes(1);
    expect(counters.tasks.add).toHaveBeenCalledTimes(1);
  });

  it("/event/task-created cancels a pending task-completed alert in the pre-fire delay window", () => {
    // Variant of the above: task-created arrives during the 1s armType delay,
    // before fire() ran. Pending timer must be cancelled so the alert never
    // visually fires.
    buttons.set("task", makeButton("task-completed"));
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    // Simulate the pending alert by calling fireTaskCompleted (enters PENDING).
    d.fireTaskCompleted("sess-test");
    vi.advanceTimersByTime(500); // half the 1s delay
    d.handleRoute("/event/task-created", "sess-test", { taskId: "task-1" });
    vi.advanceTimersByTime(5000);
    expect(buttons.get("task")!.alert).not.toHaveBeenCalled();
    expect(counters.tasks.add).toHaveBeenCalledTimes(1);
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

describe("deriveRoute — interrupt derivation (PostToolUseFailure is_interrupt)", () => {
  it("returns the interrupt variant for post-tool-use-failure when isInterrupt is true", () => {
    expect(deriveRoute("/event/post-tool-use-failure", undefined, undefined, "s", true))
      .toBe("/event/post-tool-use-failure-interrupt");
  });

  it("passes post-tool-use-failure through unchanged when isInterrupt is false/absent (a real tool error)", () => {
    expect(deriveRoute("/event/post-tool-use-failure", undefined, undefined, "s", false))
      .toBe("/event/post-tool-use-failure");
    expect(deriveRoute("/event/post-tool-use-failure", undefined, undefined, "s"))
      .toBe("/event/post-tool-use-failure");
  });

  it("agent check wins: a subagent's interrupting failure (agentId present) still drops to null", () => {
    expect(deriveRoute("/event/post-tool-use-failure", undefined, "agt-001", "s", true)).toBeNull();
  });

  it("isInterrupt only affects post-tool-use-failure — other routes ignore it", () => {
    expect(deriveRoute("/event/stop", undefined, undefined, "s", true)).toBe("/event/stop");
    expect(deriveRoute("/event/post-tool-use", undefined, undefined, "s", true)).toBe("/event/post-tool-use");
  });
});

describe("deriveRoute — agent-context drop policy", () => {
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
    // NOTE: subagent-start and subagent-stop are NOT in DROP_ROUTES —
    // they are passthrough routes (agent_id is always present on these).
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

  it("returns the route itself for /event/subagent-start with agentId (passthrough)", () => {
    expect(deriveRoute("/event/subagent-start", undefined, "agt-001", "s")).toBe("/event/subagent-start");
  });

  it("returns the route itself for /event/subagent-stop with agentId (passthrough)", () => {
    expect(deriveRoute("/event/subagent-stop", undefined, "agt-001", "s")).toBe("/event/subagent-stop");
  });

  it("agent check wins over source logic: agentId + source=compact on session-start → null", () => {
    // Precedence: agent check is evaluated FIRST; source logic only runs in the
    // agentId-absent branch. A compact-resume session-start from an agent context
    // still drops (null), not the soft route.
    expect(deriveRoute("/event/session-start", "compact", "agt-001", "s")).toBeNull();
    expect(deriveRoute("/event/session-start", "resume", "agt-001", "s")).toBeNull();
  });
});

describe("deriveRoute — session-id gate (evaluated before agent-context check)", () => {
  // Derived from the exported ACTION_ROUTES set — stays in sync when routes are added.
  const ACTION_ROUTES_DERIVED = [...ACTION_ROUTES_EXPORT];

  it("returns null for every action route when sessionId is undefined", () => {
    for (const route of ACTION_ROUTES_DERIVED) {
      expect(deriveRoute(route, undefined, undefined, undefined)).toBeNull();
    }
  });

  it("returns null for every action route when sessionId is empty string", () => {
    for (const route of ACTION_ROUTES_DERIVED) {
      expect(deriveRoute(route, undefined, undefined, "")).toBeNull();
    }
  });

  it("returns non-null for every action route when sessionId is a non-empty string", () => {
    for (const route of ACTION_ROUTES_DERIVED) {
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
});

describe("deriveRoute invariant — every emission is a known matrix key", () => {
  // Drift insurance: if the SESSION_START_SOFT constant and the ROUTES matrix
  // row ever diverge, the soft route falls into handleRoute's `unknown route=`
  // debug path and silently becomes a no-op "for the wrong reason". An injected
  // log stub is the ONLY observable that distinguishes "found in ROUTES" from
  // "unknown route" — every behavioral signal (counter calls, dismisses, PENDING
  // timers) is identical for both states, because the soft row is {clears: []}.
  it("every deriveRoute emission for session-start is a known ROUTES key (positive: handleRoute logs it as found)", () => {
    const debug = vi.fn<(msg: string) => void>();
    const log = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      log,
    });
    for (const source of ["startup", "clear", "compact", "resume", undefined, "rewind"]) {
      debug.mockClear();
      const derived = deriveRoute("/event/session-start", source, undefined, "s");
      expect(derived).not.toBeNull();
      d.handleRoute(derived!, "sess-test");
      // Positive assertion: handleRoute's own "row found" log line was emitted for
      // this exact derived route. If a source ever stopped resolving to a known
      // ROUTES row, handleRoute would take the `unknown route=` early-return branch
      // instead and this line would never be logged — unlike a negative
      // "log does NOT contain X" assertion, this breaks loudly (not vacuously) on
      // that regression, and survives any rewording of the "unknown route=" string.
      expect(debug.mock.calls.flat().some((m) => String(m).includes(`handleRoute route=${derived}`))).toBe(true);
    }
  });

  it("handleRoute(/event/session-start-soft) makes zero counter calls and leaves ARMED state intact", () => {
    buttons.set("perm", makeButton("permission"));
    const counters = fakeCounters();
    globals.alertDelay.permission = 0; // permission fires immediately on arm
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/permission-request", "sess-test"); // delay=0 → fires → ARMED (makeButton's
    // alert mock sets state.alerting = true, mirroring the real action)
    // Fire the soft route.
    d.handleRoute("/event/session-start-soft", "sess-test");
    // Zero counter calls on all slots.
    expect(counters.tasks.add).not.toHaveBeenCalled();
    expect(counters.tasks.remove).not.toHaveBeenCalled();
    expect(counters.tasks.reset).not.toHaveBeenCalled();
    expect(counters.subagents.add).not.toHaveBeenCalled();
    expect(counters.subagents.remove).not.toHaveBeenCalled();
    expect(counters.subagents.reset).not.toHaveBeenCalled();
    expect(counters.thinking.add).not.toHaveBeenCalled();
    expect(counters.thinking.remove).not.toHaveBeenCalled();
    expect(counters.thinking.reset).not.toHaveBeenCalled();
    // ARMED permission is NOT dismissed (clears: []).
    expect(buttons.get("perm")!.dismiss).not.toHaveBeenCalled();
    // Contrast: the hard route DOES dismiss it.
    d.handleRoute("/event/session-start", "sess-test");
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
  });

});

describe("Dispatcher.handleRoute — TASK_COMPLETED_AGENT synthetic row (agent-context task-completed)", () => {
  it("handleRoute(TASK_COMPLETED_AGENT) decrements the tasks counter exactly once", () => {
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    // Drive via deriveRoute to use the same path as production.
    const derived = deriveRoute("/event/task-completed", undefined, "agt-001", "s");
    expect(derived).not.toBeNull();
    d.handleRoute(derived!, "s", { taskId: "task-abc" });
    expect(counters.tasks.remove).toHaveBeenCalledTimes(1);
    expect(counters.tasks.remove).toHaveBeenCalledWith("s", "task-abc");
    expect(counters.tasks.add).not.toHaveBeenCalled();
    expect(counters.tasks.reset).not.toHaveBeenCalled();
  });

  it("handleRoute(TASK_COMPLETED_AGENT) does NOT clear an armed permission alert (regression guard)", () => {
    // Bug repro: the normal /event/task-completed row has clears: ["permission"],
    // which dismisses a legitimate permission alert when a teammate completes a task.
    // The agent-context synthetic row must have clears: [] to avoid this.
    const counters = fakeCounters();
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0; // fires immediately
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/permission-request", "sess-test"); // arms permission (delay=0 → ARMED immediately)
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);

    // Teammate task-completed arrives with agentId.
    const derived = deriveRoute("/event/task-completed", undefined, "agt-teammate", "s");
    expect(derived).not.toBeNull();
    d.handleRoute(derived!, "s", { taskId: "task-abc" });

    // Permission is still ARMED — not cleared.
    expect(buttons.get("perm")!.dismiss).not.toHaveBeenCalled();
    expect(d.armedMsAgo("permission")).not.toBeNull();
    expect(counters.tasks.remove).toHaveBeenCalledTimes(1);
  });

  it("contrast: normal /event/task-completed DOES clear an armed permission alert", () => {
    // Confirms the two rows behave differently — the normal row's clears: ["permission"]
    // is intentional (permission was resolved); the agent row must not have it.
    const counters = fakeCounters();
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0;
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/permission-request", "sess-test");
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);

    d.handleRoute("/event/task-completed", "sess-test", { taskId: "task-abc" }); // normal row, same session
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
    expect(d.armedMsAgo("permission")).toBeNull();
  });
});

describe("Dispatcher.handleRoute — POST_TOOL_USE_FAILURE_INTERRUPT synthetic row (user Esc during a tool call)", () => {
  it("removes the session from the thinking counter so the sparkle/timer stop", () => {
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    const derived = deriveRoute("/event/post-tool-use-failure", undefined, undefined, "sess-xyz", true);
    expect(derived).not.toBeNull();
    d.handleRoute(derived!, "sess-xyz");
    expect(counters.thinking.remove).toHaveBeenCalledTimes(1);
    expect(counters.thinking.remove).toHaveBeenCalledWith("sess-xyz", "sess-xyz");
  });

  it("also clears an armed permission alert (mirrors the base post-tool-use-failure row)", () => {
    const counters = fakeCounters();
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0; // fires immediately → ARMED
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/permission-request", "sess-xyz");
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);

    const derived = deriveRoute("/event/post-tool-use-failure", undefined, undefined, "sess-xyz", true);
    d.handleRoute(derived!, "sess-xyz");
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
    expect(d.armedMsAgo("permission")).toBeNull();
  });

  it("contrast: the base (non-interrupt) post-tool-use-failure leaves the thinking counter untouched", () => {
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    // A real tool error (no interrupt) must not end the turn — Claude retries.
    const derived = deriveRoute("/event/post-tool-use-failure", undefined, undefined, "sess-xyz", false);
    expect(derived).toBe("/event/post-tool-use-failure");
    d.handleRoute(derived!, "sess-xyz");
    expect(counters.thinking.remove).not.toHaveBeenCalled();
  });
});

describe("Dispatcher.dismissArmed — type-wide dismiss seam", () => {
  // (1) dismissArmed on an ARMED type → armedMsAgo null + alerting buttons dismissed.
  it("dismissArmed on ARMED type clears armedMsAgo and dismisses alerting buttons of that type", () => {
    globals.alertDelay.permission = 0; // fires immediately → ARMED
    const btn = makeButton("permission");
    buttons.set("perm", btn);
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-test"); // delay=0 → ARMED, btn.alert called
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
    d.handleRoute("/event/permission-request", "sess-test"); // default 1s delay → PENDING
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
    d.handleRoute("/event/permission-request", "sess-test"); // ARMED immediately
    d.dismissArmed("permission"); // → IDLE

    // Restore normal delay for the re-arm.
    globals.alertDelay.permission = 1000;
    d.handleRoute("/event/permission-request", "sess-test"); // must re-enter PENDING, not fire instantly

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
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-test");
    vi.advanceTimersByTime(STOP_SETTLE_MS); // ARMED
    d.handleRoute("/event/permission-request", "sess-test"); // 1s delay → PENDING

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
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    globals.alertDelay.permission = 0;
    const stopBtn = makeButton("stop");
    const permBtn = makeButton("permission");
    buttons.set("stop", stopBtn);
    buttons.set("perm", permBtn);
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-test");
    vi.advanceTimersByTime(STOP_SETTLE_MS); // ARMED
    d.handleRoute("/event/permission-request", "sess-test"); // ARMED

    d.dismissArmed("stop");

    expect(d.armedMsAgo("stop")).toBeNull();
    expect(stopBtn.dismiss).toHaveBeenCalledTimes(1);
    // permission stays armed
    expect(d.armedMsAgo("permission")).not.toBeNull();
    expect(permBtn.dismiss).not.toHaveBeenCalled();
  });
});

describe("Dispatcher.handleRoute — missing-id gate (fires before clears/arms)", () => {
  it("task-created without taskId drops before clears — no counter call, no alert dismissal", () => {
    const counters = fakeCounters();
    const armedTask = makeButton("task-completed", true);
    buttons.set("task", armedTask);
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
      log,
    });
    // task-created has clears: ["task-completed"] — without the gate,
    // a missing taskId would silently dismiss the armed alert while adding nothing.
    d.handleRoute("/event/task-created", "sess-test", {}); // no taskId
    expect(counters.tasks.add).not.toHaveBeenCalled();
    expect(armedTask.dismiss).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("drop missing-id"));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("metric=tasks"));
  });

  it("task-completed without taskId drops before clears — no counter call, no permission dismissal", () => {
    const counters = fakeCounters();
    const armedPerm = makeButton("permission", true);
    buttons.set("perm", armedPerm);
    globals.alertDelay.permission = 0;
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
      log,
    });
    d.handleRoute("/event/task-completed", "sess-test", {}); // no taskId
    expect(counters.tasks.remove).not.toHaveBeenCalled();
    expect(armedPerm.dismiss).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("drop missing-id"));
  });

  it("subagent-start without agentId drops — no counter call", () => {
    const counters = fakeCounters();
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
      log,
    });
    d.handleRoute("/event/subagent-start", "sess-test", {}); // no agentId
    expect(counters.subagents.add).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("drop missing-id"));
  });

  it("routes without counters entries are unaffected by the gate — no warn", () => {
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      log,
    });
    d.handleRoute("/event/permission-request", "sess-test"); // no ids — not gated
    expect(log.warn.mock.calls.flat().some((m) => String(m).includes("drop missing-id"))).toBe(false);
  });

  it("agent-context task-completed (TASK_COMPLETED_AGENT row) without taskId is WARN-dropped — no counter call, no clears", () => {
    const counters = fakeCounters();
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() };
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
      log,
    });
    // Simulate the derived TASK_COMPLETED_AGENT route (as plugin.ts would after deriveRoute)
    // by passing a route string that matches the TASK_COMPLETED_AGENT constant.
    // The TASK_COMPLETED_AGENT row has counters: [{metric:"tasks",op:"remove"}] and clears:[].
    // Without taskId the missing-id gate must fire before clears are applied.
    const TASK_COMPLETED_AGENT = "/event/task-completed-agent"; // must match the constant
    d.handleRoute(TASK_COMPLETED_AGENT, "sess-test", {}); // no taskId
    expect(counters.tasks.remove).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("drop missing-id"));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("metric=tasks"));
  });
});

describe("Dispatcher.handleRoute — subagent-start adds to the counter (and clears only stop); subagent-stop is counter-only", () => {
  it("subagent-start with agentId calls subagents.add and does not arm anything", () => {
    const counters = fakeCounters();
    buttons.set("stop", makeButton("stop"));
    buttons.set("perm", makeButton("permission"));
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    // Arm permission so we can check it isn't cleared
    d.handleRoute("/event/permission-request", "sess-test");
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/subagent-start", "sess-test", { agentId: "agt-001" });
    vi.advanceTimersByTime(5000);
    expect(counters.subagents.add).toHaveBeenCalledWith("sess-test", "agt-001");
    // Permission still fires — subagent-start clears stop only, not permission
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);
    // No arms triggered
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
  });

  it("subagent-stop with agentId calls subagents.remove and does not dismiss any alert", () => {
    const counters = fakeCounters();
    // Use alerting=false so handleRoute arms it cleanly (delay=0 → fires, no prior dismiss).
    const armedPerm = makeButton("permission", false);
    buttons.set("perm", armedPerm);
    globals.alertDelay.permission = 0;
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/permission-request", "sess-test"); // arms immediately (delay=0)
    d.handleRoute("/event/subagent-stop", "sess-test", { agentId: "agt-001" });
    expect(counters.subagents.remove).toHaveBeenCalledWith("sess-test", "agt-001");
    expect(armedPerm.dismiss).not.toHaveBeenCalled();
  });
});

describe("Dispatcher.handleRoute — subagent-start clears a stale stop (the next wave resumed)", () => {
  function d0(counters = fakeCounters()) {
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    return { d, counters };
  }

  it("cancels a PENDING stop when a subagent-start lands inside its delay window", () => {
    // The race: Stop arrives while the counter is momentarily empty (a between-wave
    // gap) → PENDING. A subagent-start inside the delay means the next wave started;
    // the pending stop must not fire.
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 1000;
    const { d } = d0();
    d.handleRoute("/event/stop", "sess-test", { cwd: "/repos/proj" }); // PENDING
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/subagent-start", "sess-test", { agentId: "agt-001" });
    vi.advanceTimersByTime(5000);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("dismisses an ARMED stop when a subagent-start arrives (checkmark overlapping running agents)", () => {
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    const { d } = d0();
    d.handleRoute("/event/stop", "sess-test");
    vi.advanceTimersByTime(STOP_SETTLE_MS); // ARMED (green checkmark lit)
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    d.handleRoute("/event/subagent-start", "sess-test", { agentId: "agt-001" });
    expect(buttons.get("stop")!.dismiss).toHaveBeenCalledTimes(1);
  });

  it("does not clear an armed permission alert (clears stop only)", () => {
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0;
    const { d } = d0();
    d.handleRoute("/event/permission-request", "sess-test"); // ARMED
    d.handleRoute("/event/subagent-start", "sess-test", { agentId: "agt-001" });
    expect(buttons.get("perm")!.dismiss).not.toHaveBeenCalled();
  });
});

describe("Dispatcher.handleRoute — subagent-stop cancels a PENDING stop (the settle-window canceller)", () => {
  it("cancels a PENDING stop during the settle window — no fire, no audio", () => {
    buttons.set("stop", makeButton("stop"));
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-test"); // PENDING (settle floor)
    vi.advanceTimersByTime(STOP_SETTLE_MS - 1);
    d.handleRoute("/event/subagent-stop", "sess-test", { agentId: "agt-001" });
    vi.advanceTimersByTime(5000);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("does not dismiss an already-ARMED stop", () => {
    buttons.set("stop", makeButton("stop"));
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-test");
    vi.advanceTimersByTime(STOP_SETTLE_MS); // ARMED
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    d.handleRoute("/event/subagent-stop", "sess-test", { agentId: "agt-001" });
    expect(buttons.get("stop")!.dismiss).not.toHaveBeenCalled();
  });

  it("does not drop a held (deferred) stop", () => {
    buttons.set("stop", makeButton("stop"));
    const counters = fakeCounters();
    counters.subagents.has.mockReturnValue(true); // stays "in flight" per this stub
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/stop", "sess-test", { cwd: "/repos/proj" }); // suppressed, held
    d.handleRoute("/event/subagent-stop", "sess-test", { agentId: "other-agent" });
    d.fireDeferredStop("sess-test"); // the held stop must still be there
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    expect(d.armedContext("stop")!.latestCwd).toBe("/repos/proj");
  });

  it("session B's subagent-stop does not cancel session A's pending stop", () => {
    buttons.set("stop", makeButton("stop"));
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-A");
    d.handleRoute("/event/subagent-stop", "sess-B", { agentId: "agt-001" });
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });
});

describe("Dispatcher.handleRoute — per-metric id selection", () => {
  it("user-prompt-submit calls thinking.add with (sessionId, sessionId) — thinking id = sessionId itself", () => {
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/user-prompt-submit", "sess-xyz");
    expect(counters.thinking.add).toHaveBeenCalledWith("sess-xyz", "sess-xyz");
  });

  it("stop calls thinking.remove with (sessionId, sessionId)", () => {
    const counters = fakeCounters();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    d.handleRoute("/event/stop", "sess-xyz");
    expect(counters.thinking.remove).toHaveBeenCalledWith("sess-xyz", "sess-xyz");
  });

  it("counters directives are no-ops when opts.counters is absent", () => {
    const d = dispatcher(); // no counters
    expect(() => d.handleRoute("/event/task-created", "sess-test", { taskId: "t1" })).not.toThrow();
    expect(() => d.handleRoute("/event/user-prompt-submit", "sess-test")).not.toThrow();
  });
});

describe("Dispatcher — session-scoped alert clearing (new)", () => {
  // Test 1: B's clearing route does not dismiss A's armed alert
  it("session B post-tool-use does NOT dismiss session A's armed permission alert", () => {
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-A");
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);

    d.handleRoute("/event/post-tool-use", "sess-B");
    expect(buttons.get("perm")!.dismiss).not.toHaveBeenCalled();
    expect(d.armedMsAgo("permission")).not.toBeNull();
  });

  // Test 2: Own-session clear works correctly
  it("session A's own post-tool-use clears its armed permission", () => {
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-A");
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);

    d.handleRoute("/event/post-tool-use", "sess-A");
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
    expect(d.armedMsAgo("permission")).toBeNull();
  });

  // Test 3: dismissArmed wipes all sessions and cancels per-session pending timers (iteration pin)
  it("dismissArmed clears all sessions for a type and cancels every per-session pending timer", () => {
    buttons.set("perm", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-A"); // PENDING (1s default delay)
    d.handleRoute("/event/permission-request", "sess-B"); // PENDING independently
    // Neither has fired yet
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();

    d.dismissArmed("permission");

    // Advance well past the delay — neither timer should fire
    vi.advanceTimersByTime(5000);
    expect(buttons.get("perm")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
    expect(d.armedMsAgo("permission")).toBeNull();
  });

  // Test 4: Per-session pending cancellation — own session only
  it("session A's clearing route cancels only A's pending timer; B's still fires", () => {
    buttons.set("perm", makeButton("permission"));
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-A"); // PENDING
    d.handleRoute("/event/permission-request", "sess-B"); // PENDING
    vi.advanceTimersByTime(500);

    d.handleRoute("/event/post-tool-use", "sess-A"); // cancels A only

    vi.advanceTimersByTime(1000); // B fires at t≈1000
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1); // only B fired
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    // armedMsAgo is non-null because B is armed
    expect(d.armedMsAgo("permission")).not.toBeNull();
  });

  // Test 5: Independent pending timers — B arms while A is PENDING (edge #6)
  it("B arming the same type while A is PENDING → two independent fires", () => {
    buttons.set("perm", makeButton("permission"));
    const d = dispatcher();
    globals.alertDelay.permission = 1000;
    d.handleRoute("/event/permission-request", "sess-A"); // PENDING, fires at t=1000
    vi.advanceTimersByTime(500);
    d.handleRoute("/event/permission-request", "sess-B"); // PENDING, fires at t=1500
    vi.advanceTimersByTime(500); // total t=1000 → A fires
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1); // A fired
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000); // total t=2000 (B fired at t=1500)
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(2); // B fired
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
  });

  // Test 6: B arms while A is ARMED → armedContext count=2, latest cwd=B, audio replays (edge #8)
  it("B arming while A already ARMED → armedContext count=2, audio plays again", () => {
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-A"); // ARMED immediately
    const ctx1 = d.armedContext("permission");
    expect(ctx1).not.toBeNull();
    expect(ctx1!.count).toBe(1);

    d.handleRoute("/event/permission-request", "sess-B"); // re-fires; B is latest
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
    const ctx2 = d.armedContext("permission");
    expect(ctx2).not.toBeNull();
    expect(ctx2!.count).toBe(2);
  });

  // Test 7: armedMsAgo latest-wins — latest session's armedAt is used
  it("armedMsAgo returns time since the latest session's armedAt", () => {
    vi.setSystemTime(new Date("2026-06-06T00:00:00Z"));
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-A"); // armed at t=0
    vi.advanceTimersByTime(3000); // t=3000
    d.handleRoute("/event/permission-request", "sess-B"); // armed at t=3000 → latest
    // armedMsAgo should be ~0 (latest wins), not ~3000 (A's time)
    expect(d.armedMsAgo("permission")).toBe(0);
  });

  // Test 8: armedMsAgo null after last session entry is removed (prune-on-empty pin)
  it("armedMsAgo is null after the last armed session entry is cleared", () => {
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-A");
    expect(d.armedMsAgo("permission")).not.toBeNull();

    d.handleRoute("/event/post-tool-use", "sess-A"); // clear A's entry
    expect(d.armedMsAgo("permission")).toBeNull();
  });

  // Test 9: Same-session re-fire replay still works per-session (existing pin, now per-session)
  it("same-session re-arm on an already-ARMED type re-fires audio (per-session re-fire)", () => {
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-A");
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    d.handleRoute("/event/permission-request", "sess-A"); // re-fire same session
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1); // dismiss before re-alert
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(2);
  });

  // Test 10: fireTaskCompleted(sessionId) arms only that session; clearing routes are
  // session-scoped — B's session-end must NOT clear A's entry (spec edge #4).
  it("fireTaskCompleted(sessionId) arms only the given session; B's session-end does NOT clear A", () => {
    buttons.set("task", makeButton("task-completed"));
    globals.alertDelay["task-completed"] = 0; // fire immediately — this test is about scoping, not timing
    const d = dispatcher();
    d.fireTaskCompleted("sess-A");
    expect(buttons.get("task")!.alert).toHaveBeenCalledTimes(1);
    expect(d.armedMsAgo("task-completed")).not.toBeNull();

    d.handleRoute("/event/session-end", "sess-B"); // B's clear is scoped to B
    expect(d.armedMsAgo("task-completed")).not.toBeNull(); // A still armed
    expect(buttons.get("task")!.dismiss).not.toHaveBeenCalled();

    d.handleRoute("/event/session-end", "sess-A"); // A's own clear removes A
    expect(d.armedMsAgo("task-completed")).toBeNull();
    expect(buttons.get("task")!.dismiss).toHaveBeenCalledTimes(1);
  });

  // Test 10b: B's pre-tool-use does not clear A's armed stop alert
  it("session B's pre-tool-use does not clear A's armed stop alert", () => {
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    const d = dispatcher();
    d.handleRoute("/event/stop", "sess-A");
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(d.armedMsAgo("stop")).not.toBeNull();

    d.handleRoute("/event/pre-tool-use", "sess-B"); // B's pre-tool-use clears B's stop only
    expect(d.armedMsAgo("stop")).not.toBeNull(); // A's still armed
    expect(buttons.get("stop")!.dismiss).not.toHaveBeenCalled();
  });

  // Test 11: onArmedChanged fires exactly once per ARMED-map mutation, never on PENDING
  it("onArmedChanged fires once when an entry is added to armed (not on pending entry)", () => {
    const onArmedChanged = vi.fn<(type: EventType) => void>();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      onArmedChanged,
    });
    // PENDING: should NOT fire onArmedChanged
    d.handleRoute("/event/permission-request", "sess-A"); // enters PENDING (1s delay)
    expect(onArmedChanged).not.toHaveBeenCalled();
    // ARMED: fires once
    vi.advanceTimersByTime(1000);
    expect(onArmedChanged).toHaveBeenCalledTimes(1);
    expect(onArmedChanged).toHaveBeenCalledWith("permission");
  });

  it("onArmedChanged fires once when clearType removes an armed entry", () => {
    const onArmedChanged = vi.fn<(type: EventType) => void>();
    globals.alertDelay.permission = 0;
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      onArmedChanged,
    });
    d.handleRoute("/event/permission-request", "sess-A"); // fires immediately → ARMED, onArmedChanged called once
    onArmedChanged.mockClear();
    d.handleRoute("/event/post-tool-use", "sess-A"); // removes entry → onArmedChanged called once more
    expect(onArmedChanged).toHaveBeenCalledTimes(1);
    expect(onArmedChanged).toHaveBeenCalledWith("permission");
  });

  it("onArmedChanged fires once on dismissArmed when the armed map was non-empty", () => {
    const onArmedChanged = vi.fn<(type: EventType) => void>();
    globals.alertDelay.permission = 0;
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      onArmedChanged,
    });
    d.handleRoute("/event/permission-request", "sess-A");
    onArmedChanged.mockClear();
    d.dismissArmed("permission");
    expect(onArmedChanged).toHaveBeenCalledTimes(1);
    expect(onArmedChanged).toHaveBeenCalledWith("permission");
  });

  it("onArmedChanged does NOT fire on dismissArmed when no sessions were armed (IDLE dismissal)", () => {
    const onArmedChanged = vi.fn<(type: EventType) => void>();
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      onArmedChanged,
    });
    d.dismissArmed("permission"); // IDLE → no-op
    expect(onArmedChanged).not.toHaveBeenCalled();
  });

  // Test 12: armedContext null when no sessions armed; count+latestCwd correct when armed
  it("armedContext returns null when no sessions are armed", () => {
    const d = dispatcher();
    expect(d.armedContext("permission")).toBeNull();
    expect(d.armedContext("stop")).toBeNull();
    expect(d.armedContext("task-completed")).toBeNull();
  });

  it("armedContext returns correct count and latestCwd for one armed session", () => {
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    // handleRoute widened ctx param — pass cwd via ctx
    d.handleRoute("/event/permission-request", "sess-A", { cwd: "/home/user/my-project" });
    const ctx = d.armedContext("permission");
    expect(ctx).not.toBeNull();
    expect(ctx!.count).toBe(1);
    expect(ctx!.latestCwd).toBe("/home/user/my-project");
  });

  it("armedContext latestCwd is from the most recently armed session (latest-wins)", () => {
    vi.setSystemTime(new Date("2026-06-06T00:00:00Z"));
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-A", { cwd: "/repos/alpha" });
    vi.advanceTimersByTime(100);
    d.handleRoute("/event/permission-request", "sess-B", { cwd: "/repos/beta" }); // armed later
    const ctx = d.armedContext("permission");
    expect(ctx!.count).toBe(2);
    expect(ctx!.latestCwd).toBe("/repos/beta");
  });

  // Edge #5 pin: both sessions ARMED, one clears → key stays lit, no dismiss,
  // armedContext flips to the remaining session, audio does not replay.
  it("clearing one of two ARMED sessions keeps the key lit and does not dismiss", () => {
    buttons.set("perm", makeButton("permission"));
    globals.alertDelay.permission = 0;
    const d = dispatcher();
    d.handleRoute("/event/permission-request", "sess-A", { cwd: "/repos/alpha" });
    d.handleRoute("/event/permission-request", "sess-B", { cwd: "/repos/beta" });
    // B's arm pulse-restarts: one dismiss+re-alert so far
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);

    d.handleRoute("/event/post-tool-use", "sess-A"); // A clears; B remains ARMED

    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1); // unchanged — key stays lit
    expect(audioPlayer.play).toHaveBeenCalledTimes(2); // no replay on clear
    const ctx = d.armedContext("permission");
    expect(ctx).not.toBeNull();
    expect(ctx!.count).toBe(1);
    expect(ctx!.latestCwd).toBe("/repos/beta");
    expect(d.armedMsAgo("permission")).not.toBeNull();
  });
});

describe("Dispatcher.handleRoute — stop suppressed while subagents in flight", () => {
  function withSubagents(inFlight: boolean) {
    const counters = fakeCounters();
    counters.subagents.has.mockReturnValue(inFlight);
    const d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters,
    });
    return { d, counters };
  }

  it("suppresses the stop alert silently (no flash, no audio)", () => {
    buttons.set("stop", makeButton("stop"));
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test", { cwd: "/repos/proj" });
    vi.advanceTimersByTime(5000);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("still applies the stop route's clears while suppressing the arm", () => {
    buttons.set("perm", makeButton("permission"));
    const { d } = withSubagents(true);
    globals.alertDelay.permission = 0;
    d.handleRoute("/event/permission-request", "sess-test"); // ARMED immediately
    expect(buttons.get("perm")!.alert).toHaveBeenCalledTimes(1);
    d.handleRoute("/event/stop", "sess-test"); // suppressed arm, but clears permission
    expect(buttons.get("perm")!.dismiss).toHaveBeenCalledTimes(1);
  });

  it("still decrements the thinking counter when the stop is suppressed", () => {
    const { d, counters } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test");
    expect(counters.thinking.remove).toHaveBeenCalledWith("sess-test", "sess-test");
  });

  it("fireDeferredStop releases the held stop after the settle window (deferred chime)", () => {
    buttons.set("stop", makeButton("stop"));
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test", { cwd: "/repos/proj" });
    vi.advanceTimersByTime(5000);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();

    d.fireDeferredStop("sess-test"); // subagents drained → release, now settles
    vi.advanceTimersByTime(STOP_SETTLE_MS - 1);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled(); // still settling
    vi.advanceTimersByTime(1);
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("the deferred stop carries the cwd captured at suppression time", () => {
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test", { cwd: "/repos/captured" });
    d.fireDeferredStop("sess-test");
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(d.armedContext("stop")!.latestCwd).toBe("/repos/captured");
  });

  it("fireDeferredStop is a no-op when the session has no held stop", () => {
    buttons.set("stop", makeButton("stop"));
    const { d } = withSubagents(true);
    d.fireDeferredStop("never-suppressed");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
  });

  it("a stop-clearing route drops the held stop — no chime on later drain", () => {
    buttons.set("stop", makeButton("stop"));
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test"); // suppressed
    d.handleRoute("/event/user-prompt-submit", "sess-test"); // agent resumed
    d.fireDeferredStop("sess-test"); // late drain — held stop already gone
    vi.advanceTimersByTime(5000);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("pre-tool-use also drops the held stop (agentic loop restarted)", () => {
    buttons.set("stop", makeButton("stop"));
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test");
    d.handleRoute("/event/pre-tool-use", "sess-test");
    d.fireDeferredStop("sess-test");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
  });

  it("dismissArmed(stop) clears all held stops so no deferred chime survives", () => {
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-A");
    d.handleRoute("/event/stop", "sess-B");
    d.dismissArmed("stop");
    // Neither held stop can chime afterwards.
    d.fireDeferredStop("sess-A");
    d.fireDeferredStop("sess-B");
    vi.advanceTimersByTime(5000);
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("arms normally (no suppression) when no subagents are in flight", () => {
    buttons.set("stop", makeButton("stop"));
    const { d } = withSubagents(false);
    d.handleRoute("/event/stop", "sess-test");
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("latest cwd wins when a session is suppressed twice before draining", () => {
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test", { cwd: "/repos/first" });
    d.handleRoute("/event/stop", "sess-test", { cwd: "/repos/second" });
    d.fireDeferredStop("sess-test");
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(d.armedContext("stop")!.latestCwd).toBe("/repos/second");
  });

  it("session-start drops the held stop — no chime on a later drain", () => {
    buttons.set("stop", makeButton("stop"));
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test"); // suppressed
    d.handleRoute("/event/session-start", "sess-test"); // boundary clears it
    d.fireDeferredStop("sess-test");
    vi.advanceTimersByTime(5000);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("the deferred stop clears a task-completed alert that armed during the hold", () => {
    // Regression guard: while subagents run, the tasks counter can drain and arm
    // task-completed. The deferred stop must dismiss it, exactly as a real Stop
    // (clears: ["permission", "task-completed"]) would.
    buttons.set("stop", makeButton("stop"));
    const task = makeButton("task-completed");
    buttons.set("task", task);
    globals.alertDelay.stop = 0;
    globals.alertDelay["task-completed"] = 0;
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test"); // suppressed
    d.fireTaskCompleted("sess-test"); // task-completed arms during the hold
    expect(task.alert).toHaveBeenCalledTimes(1);
    d.fireDeferredStop("sess-test"); // deferred completion
    expect(task.dismiss).toHaveBeenCalledTimes(1);
    expect(d.armedMsAgo("task-completed")).toBeNull();
  });

  it("drives the real subagent-stop → drain → deferred chime path end to end", () => {
    // Integration: a real SessionSetCounter wired exactly as plugin.ts wires it
    // (onSessionDrained → fireDeferredStop). Pins the production seam the other
    // tests stub by calling fireDeferredStop directly.
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    let d!: Dispatcher;
    const subagents = new SessionSetCounter({
      name: "subagents",
      onSessionDrained: (sid) => d.fireDeferredStop(sid),
      onChanged: () => {},
    });
    const mocks = fakeCounters();
    d = new Dispatcher({
      audioPlayer: audioPlayer as unknown as { play: (p: string) => void },
      getGlobalSettings: () => globals,
      getButtons: () => buttons as unknown as Map<string, DispatchableButton>,
      counters: { tasks: mocks.tasks, subagents, thinking: mocks.thinking },
    });

    d.handleRoute("/event/subagent-start", "s1", { agentId: "a1" });
    d.handleRoute("/event/stop", "s1"); // subagent in flight → suppressed
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    expect(audioPlayer.play).not.toHaveBeenCalled();

    d.handleRoute("/event/subagent-stop", "s1", { agentId: "a1" }); // drains → deferred chime, settles
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("only one session's held stop is released on its own drain", () => {
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-A");
    d.handleRoute("/event/stop", "sess-B");
    d.fireDeferredStop("sess-A"); // only A drained
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    // B is still held; its drain releases it independently.
    d.fireDeferredStop("sess-B");
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(audioPlayer.play).toHaveBeenCalledTimes(2);
  });

  it("safety timer releases a held stop when the subagent drain never arrives", () => {
    // The bug: a lost subagent-stop (or one without agent_id) leaves the counter
    // stuck >0, so onSessionDrained never fires fireDeferredStop. The backstop
    // releases the chime anyway (after which it still settles like any deferred stop).
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test", { cwd: "/repos/proj" });
    vi.advanceTimersByTime(STOP_SAFETY_RELEASE_MS - 1);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled(); // still held
    vi.advanceTimersByTime(1); // safety timer fires → fireDeferredStop → PENDING (settle)
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled(); // now settling
    vi.advanceTimersByTime(STOP_SETTLE_MS - 1);
    expect(buttons.get("stop")!.alert).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(buttons.get("stop")!.alert).toHaveBeenCalledTimes(1);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    expect(d.armedContext("stop")!.latestCwd).toBe("/repos/proj"); // cwd preserved
  });

  it("a real drain before the safety window cancels the backstop — exactly one chime", () => {
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test");
    d.fireDeferredStop("sess-test"); // subagents drained normally
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(STOP_SAFETY_RELEASE_MS); // backstop must not re-fire
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  });

  it("a stop-clearing route cancels the backstop — no chime at the safety deadline", () => {
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 0;
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test"); // suppressed, backstop armed
    d.handleRoute("/event/user-prompt-submit", "sess-test"); // agent resumed
    vi.advanceTimersByTime(STOP_SAFETY_RELEASE_MS);
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("dismissArmed(stop) cancels every backstop — no orphaned chime later", () => {
    globals.alertDelay.stop = 0;
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-A");
    d.handleRoute("/event/stop", "sess-B");
    d.dismissArmed("stop");
    vi.advanceTimersByTime(STOP_SAFETY_RELEASE_MS);
    expect(audioPlayer.play).not.toHaveBeenCalled();
  });

  it("re-suppression restarts the backstop window — one chime, at the latest deadline", () => {
    buttons.set("stop", makeButton("stop"));
    globals.alertDelay.stop = 0; // still floors to STOP_SETTLE_MS
    const { d } = withSubagents(true);
    d.handleRoute("/event/stop", "sess-test", { cwd: "/repos/first" });
    vi.advanceTimersByTime(STOP_SAFETY_RELEASE_MS - 1000); // almost expired
    d.handleRoute("/event/stop", "sess-test", { cwd: "/repos/second" }); // restarts window
    vi.advanceTimersByTime(1000); // original deadline passes — must NOT fire
    expect(audioPlayer.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(STOP_SAFETY_RELEASE_MS - 1000); // reach the new deadline — safety fires, now settling
    expect(audioPlayer.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(STOP_SETTLE_MS);
    expect(audioPlayer.play).toHaveBeenCalledTimes(1);
    expect(d.armedContext("stop")!.latestCwd).toBe("/repos/second");
  });
});
