import { describe, it, expect, vi, beforeEach } from "vitest";
import { TurnClock } from "../src/turn-clock.js";
import type { DispatcherCounter } from "../src/dispatcher.js";

// ---- Construction helpers ----

function makeInner(): DispatcherCounter & {
  addCalls: Array<[string, string]>;
  removeCalls: Array<[string, string]>;
  resetCalls: string[];
} {
  const addCalls: Array<[string, string]> = [];
  const removeCalls: Array<[string, string]> = [];
  const resetCalls: string[] = [];
  return {
    addCalls,
    removeCalls,
    resetCalls,
    add(sessionId, id) { addCalls.push([sessionId, id]); },
    remove(sessionId, id) { removeCalls.push([sessionId, id]); },
    reset(sessionId) { resetCalls.push(sessionId); },
  };
}

describe("TurnClock", () => {
  let inner: ReturnType<typeof makeInner>;
  let now: ReturnType<typeof vi.fn<() => number>>;

  beforeEach(() => {
    inner = makeInner();
    now = vi.fn<() => number>().mockReturnValue(1000);
  });

  // ---- Delegation ----

  it("add() delegates to inner.add with the same arguments", () => {
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    expect(inner.addCalls).toEqual([["sess-A", "sess-A"]]);
  });

  it("remove() delegates to inner.remove with the same arguments", () => {
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    clock.remove("sess-A", "sess-A");
    expect(inner.removeCalls).toEqual([["sess-A", "sess-A"]]);
  });

  it("reset() delegates to inner.reset with the same sessionId", () => {
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    clock.reset("sess-A");
    expect(inner.resetCalls).toEqual(["sess-A"]);
  });

  // ---- null when empty ----

  it("currentElapsedMs() returns null when no sessions are tracked", () => {
    const clock = new TurnClock({ inner, now });
    expect(clock.currentElapsedMs()).toBeNull();
  });

  // ---- Single session ----

  it("currentElapsedMs() returns elapsed ms for a tracked session", () => {
    now.mockReturnValueOnce(1000).mockReturnValue(4500);
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    expect(clock.currentElapsedMs()).toBe(3500);
  });

  it("remove() clears the session entry; currentElapsedMs() returns null after drain", () => {
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    clock.remove("sess-A", "sess-A");
    expect(clock.currentElapsedMs()).toBeNull();
  });

  it("reset() clears the session entry; currentElapsedMs() returns null after reset", () => {
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    clock.reset("sess-A");
    expect(clock.currentElapsedMs()).toBeNull();
  });

  // ---- Timestamp recorded BEFORE delegation (first repaint sees clock entry) ----

  it("timestamp is recorded before inner.add is called — inner.add can observe the clock", () => {
    let clockSeenMs: number | null = null;
    const capturingInner: DispatcherCounter = {
      add(sessionId) {
        // Simulate broadcastThinking calling currentElapsedMs inside the add callback
        clockSeenMs = clock.currentElapsedMs();
      },
      remove() {},
      reset() {},
    };
    now.mockReturnValueOnce(2000).mockReturnValue(5000);
    const clock = new TurnClock({ inner: capturingInner, now });
    clock.add("sess-A", "sess-A");
    // At the time inner.add ran, now() returned 5000 (the second call) but the
    // startMs was captured before the delegation at 2000. Elapsed = 5000 - 2000 = 3000.
    expect(clockSeenMs).toBe(3000);
  });

  // ---- Duplicate add: refreshes timestamp, no-op on Map position ----

  it("duplicate add refreshes the timestamp — cancel-resubmit restarts the displayed timer", () => {
    // Esc-cancel fires no hook (Stop skips user interrupts), so the session stays
    // tracked with a stale start. The resubmit's user-prompt-submit (duplicate add)
    // must refresh the timestamp or the timer shows idle wall-clock time.
    now
      .mockReturnValueOnce(1000)  // A first add
      .mockReturnValueOnce(4000)  // A duplicate add — refresh
      .mockReturnValue(5000);     // currentElapsedMs calls
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    clock.add("sess-A", "sess-A"); // duplicate — timestamp refreshed to 4000
    // Elapsed = 5000 - 4000 = 1000 (NOT 5000 - 1000 = 4000).
    expect(clock.currentElapsedMs()).toBe(1000);
  });

  it("duplicate add for already-tracked session is no-op on Map position", () => {
    // Session A added at t=1000, session B added at t=2000.
    // Duplicate add for A refreshes A's timestamp but must not re-insert A at tail
    // (B must still be the last-inserted = displayed session).
    now
      .mockReturnValueOnce(1000)  // A add
      .mockReturnValueOnce(2000)  // B add
      .mockReturnValue(5000);     // A duplicate add + currentElapsedMs calls
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    clock.add("sess-B", "sess-B");
    clock.add("sess-A", "sess-A"); // duplicate — position no-op (B stays displayed)

    // B is the last-inserted non-duplicate → displayed. Elapsed = 5000 - 2000 = 3000.
    expect(clock.currentElapsedMs()).toBe(3000);
  });

  it("duplicate add still delegates to inner.add (inner decides dedup via its own Set)", () => {
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    clock.add("sess-A", "sess-A"); // duplicate
    // TurnClock always delegates regardless of its own dedup guard
    expect(inner.addCalls).toHaveLength(2);
  });

  // ---- Re-add after remove inserts at tail (becomes displayed) ----

  it("re-add after remove inserts session at tail — it becomes the displayed session", () => {
    // A added, B added, A removed, A re-added → A is at tail, B was previously last.
    now
      .mockReturnValueOnce(1000)  // A first add
      .mockReturnValueOnce(2000)  // B add
      .mockReturnValueOnce(9000)  // A re-add (new timestamp recorded)
      .mockReturnValue(10000);    // currentElapsedMs calls
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    clock.add("sess-B", "sess-B");
    clock.remove("sess-A", "sess-A");
    clock.add("sess-A", "sess-A"); // re-add — A goes to tail
    // A re-inserted at t=9000 → elapsed = 10000 - 9000 = 1000. A is displayed.
    expect(clock.currentElapsedMs()).toBe(1000);
  });

  // ---- Latest-wins (last-inserted still-tracked session) ----

  it("currentElapsedMs() shows the last-inserted still-tracked session", () => {
    now
      .mockReturnValueOnce(1000)  // A add
      .mockReturnValueOnce(3000)  // B add
      .mockReturnValue(8000);     // reads
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    clock.add("sess-B", "sess-B");
    // B is last-inserted. Elapsed = 8000 - 3000 = 5000.
    expect(clock.currentElapsedMs()).toBe(5000);
  });

  it("fallback to previous session when the last-inserted session is removed", () => {
    now
      .mockReturnValueOnce(1000)  // A add
      .mockReturnValueOnce(3000)  // B add
      .mockReturnValue(8000);     // reads
    const clock = new TurnClock({ inner, now });
    clock.add("sess-A", "sess-A");
    clock.add("sess-B", "sess-B");
    clock.remove("sess-B", "sess-B"); // B removed → fallback to A
    // A was added at t=1000. Elapsed = 8000 - 1000 = 7000.
    expect(clock.currentElapsedMs()).toBe(7000);
  });

  // ---- Injectable now defaults to Date.now ----

  it("defaults now to Date.now when not injected", () => {
    const clock = new TurnClock({ inner });
    clock.add("sess-A", "sess-A");
    const elapsed = clock.currentElapsedMs();
    expect(elapsed).not.toBeNull();
    expect(elapsed!).toBeGreaterThanOrEqual(0);
  });
});
