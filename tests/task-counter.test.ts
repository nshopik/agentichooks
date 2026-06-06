import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskCounter } from "../src/task-counter.js";

let onCountChanged: ReturnType<typeof vi.fn<(count: number) => void>>;
let onZeroReached: ReturnType<typeof vi.fn<() => void>>;
let log: { info: ReturnType<typeof vi.fn<(msg: string) => void>>; warn: ReturnType<typeof vi.fn<(msg: string) => void>>; error: ReturnType<typeof vi.fn<(msg: string) => void>>; debug: ReturnType<typeof vi.fn<(msg: string) => void>>; trace: ReturnType<typeof vi.fn<(msg: string) => void>> };

beforeEach(() => {
  onCountChanged = vi.fn<(count: number) => void>();
  onZeroReached = vi.fn<() => void>();
  log = { info: vi.fn<(msg: string) => void>(), warn: vi.fn<(msg: string) => void>(), error: vi.fn<(msg: string) => void>(), debug: vi.fn<(msg: string) => void>(), trace: vi.fn<(msg: string) => void>() };
});

function newCounter() {
  return new TaskCounter({ onCountChanged, onZeroReached, log });
}

describe("TaskCounter", () => {
  it("starts at 0", () => {
    expect(newCounter().current()).toBe(0);
  });

  it("increment raises sum and fires onCountChanged with new sum", () => {
    const c = newCounter();
    c.increment("sess-A");
    expect(c.current()).toBe(1);
    expect(onCountChanged).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledWith(1);
    expect(onZeroReached).not.toHaveBeenCalled();
  });

  it("decrement from >0 to >0 lowers sum and fires onCountChanged only", () => {
    const c = newCounter();
    c.increment("sess-A");
    c.increment("sess-A");
    onCountChanged.mockClear();
    c.decrement("sess-A");
    expect(c.current()).toBe(1);
    expect(onCountChanged).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledWith(1);
    expect(onZeroReached).not.toHaveBeenCalled();
  });

  it("decrement from >0 to 0 for that session fires onZeroReached then onCountChanged(0) — order matters", () => {
    const c = newCounter();
    c.increment("sess-A");
    onCountChanged.mockClear();
    const callOrder: string[] = [];
    onZeroReached.mockImplementation(() => callOrder.push("zero"));
    onCountChanged.mockImplementation(() => callOrder.push("count"));
    c.decrement("sess-A");
    expect(c.current()).toBe(0);
    expect(callOrder).toEqual(["zero", "count"]);
    expect(onZeroReached).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledWith(0);
  });

  it("decrement at 0 for unknown session floors, logs warn with session prefix, fires no callbacks (drift case)", () => {
    const c = newCounter();
    c.decrement("sess-unknown");
    expect(c.current()).toBe(0);
    expect(onCountChanged).not.toHaveBeenCalled();
    expect(onZeroReached).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("sess-unk"));
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("count=0"));
  });

  it("decrement at 0 for a session that existed but was decremented to 0 already — same drift floor", () => {
    const c = newCounter();
    c.increment("sess-A");
    c.decrement("sess-A"); // goes to 0, entry deleted, onZeroReached fires
    onZeroReached.mockClear();
    onCountChanged.mockClear();
    c.decrement("sess-A"); // entry gone — drift
    expect(c.current()).toBe(0);
    expect(onCountChanged).not.toHaveBeenCalled();
    expect(onZeroReached).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("count=0"));
  });

  it("reset from >0 zeros that session's entry, fires onCountChanged(0), does NOT fire onZeroReached (silent)", () => {
    const c = newCounter();
    c.increment("sess-A");
    c.increment("sess-A");
    c.increment("sess-A");
    onCountChanged.mockClear();
    c.reset("sess-A");
    expect(c.current()).toBe(0);
    expect(onCountChanged).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledWith(0);
    expect(onZeroReached).not.toHaveBeenCalled();
  });

  it("reset at 0 for a session is a no-op (no entry in map)", () => {
    const c = newCounter();
    c.reset("sess-A");
    expect(onCountChanged).not.toHaveBeenCalled();
    expect(onZeroReached).not.toHaveBeenCalled();
  });

  it("reset for a session only deletes that session's entry — other sessions are unaffected", () => {
    const c = newCounter();
    c.increment("sess-A");
    c.increment("sess-A");
    c.increment("sess-B");
    onCountChanged.mockClear();
    c.reset("sess-A");
    // sum drops by 2 (sess-A's two tasks); sess-B's 1 task remains
    expect(c.current()).toBe(1);
    expect(onCountChanged).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledWith(1);
  });

  it("burst: 5 increments then 5 decrements on one session ends at 0 with onZeroReached fired exactly once", () => {
    const c = newCounter();
    for (let i = 0; i < 5; i++) c.increment("sess-A");
    for (let i = 0; i < 5; i++) c.decrement("sess-A");
    expect(c.current()).toBe(0);
    expect(onZeroReached).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledTimes(10);
  });

  it("each increment fires its own onCountChanged with the running sum (no batching)", () => {
    const c = newCounter();
    c.increment("sess-A");
    c.increment("sess-A");
    c.increment("sess-A");
    expect(onCountChanged).toHaveBeenCalledTimes(3);
    expect(onCountChanged).toHaveBeenNthCalledWith(1, 1);
    expect(onCountChanged).toHaveBeenNthCalledWith(2, 2);
    expect(onCountChanged).toHaveBeenNthCalledWith(3, 3);
  });

  // ---- Multi-session behavioral contract ----

  it("two sessions: B completes its task → chime fires (B hit zero) while sum=2 still shows; A completes both → second chime; map is empty afterward", () => {
    const c = newCounter();
    // Session A: 2 tasks, Session B: 1 task
    c.increment("sess-A");
    c.increment("sess-A");
    c.increment("sess-B");
    expect(c.current()).toBe(3);
    onCountChanged.mockClear();
    onZeroReached.mockClear();

    // B completes its one task → B's count hits 0 → chime fires; sum drops to 2.
    c.decrement("sess-B");
    expect(onZeroReached).toHaveBeenCalledTimes(1); // chime!
    expect(c.current()).toBe(2);
    expect(onCountChanged).toHaveBeenCalledWith(2);
    onZeroReached.mockClear();
    onCountChanged.mockClear();

    // A completes first task → sum drops to 1, no chime (A still has one task).
    c.decrement("sess-A");
    expect(onZeroReached).not.toHaveBeenCalled();
    expect(c.current()).toBe(1);
    onCountChanged.mockClear();

    // A completes second task → A's count hits 0 → second chime; sum drops to 0.
    c.decrement("sess-A");
    expect(onZeroReached).toHaveBeenCalledTimes(1); // second chime!
    expect(c.current()).toBe(0);
    expect(onCountChanged).toHaveBeenCalledWith(0);
  });

  it("onZeroReached fires when session count crosses >0 → 0, NOT when the global sum crosses it", () => {
    const c = newCounter();
    // A has 1 task, B has 1 task → sum=2
    c.increment("sess-A");
    c.increment("sess-B");
    onZeroReached.mockClear();

    // A completes → sum becomes 1, not 0, but A's session hit 0 → chime
    c.decrement("sess-A");
    expect(onZeroReached).toHaveBeenCalledTimes(1);
    expect(c.current()).toBe(1); // global sum still non-zero
  });

  it("decrement for unknown session floors with warn log including 8-char session prefix", () => {
    const c = newCounter();
    c.decrement("abcdefghijklmnop"); // no entry in map
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("abcdefgh"));
  });

  it("session-end (reset) deletes only that session's entry and recomputes sum correctly", () => {
    const c = newCounter();
    c.increment("sess-A");
    c.increment("sess-B");
    c.increment("sess-B");
    // Session A ends
    c.reset("sess-A");
    expect(c.current()).toBe(2); // only sess-B's 2 tasks remain
    expect(onZeroReached).not.toHaveBeenCalled();
  });

  it("session-start (hard reset) for a session with no tasks is a no-op", () => {
    const c = newCounter();
    c.increment("sess-B");
    onCountChanged.mockClear();
    c.reset("sess-A"); // sess-A never incremented
    expect(c.current()).toBe(1); // sess-B unchanged
    expect(onCountChanged).not.toHaveBeenCalled();
  });
});
