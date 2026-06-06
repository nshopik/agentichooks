import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionSetCounter } from "../src/session-set-counter.js";

// ---- Construction helpers ----

function makeLog() {
  return {
    info:  vi.fn<(msg: string) => void>(),
    warn:  vi.fn<(msg: string) => void>(),
    error: vi.fn<(msg: string) => void>(),
    debug: vi.fn<(msg: string) => void>(),
    trace: vi.fn<(msg: string) => void>(),
  };
}

describe("SessionSetCounter", () => {
  let onChanged: ReturnType<typeof vi.fn<(sum: number) => void>>;
  let onSessionDrained: ReturnType<typeof vi.fn<() => void>>;
  let log: ReturnType<typeof makeLog>;

  beforeEach(() => {
    onChanged = vi.fn();
    onSessionDrained = vi.fn();
    log = makeLog();
  });

  function newCounter(withDrainCallback = true) {
    return new SessionSetCounter({
      onChanged,
      onSessionDrained: withDrainCallback ? onSessionDrained : undefined,
      log,
    });
  }

  // ---- sum() / initial state ----

  it("starts at sum=0", () => {
    expect(newCounter().sum()).toBe(0);
  });

  // ---- add() dedup ----

  it("add(sessionId, id) increments sum and fires onChanged with new sum", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    expect(c.sum()).toBe(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith(1);
    expect(onSessionDrained).not.toHaveBeenCalled();
  });

  it("repeated add of the same id is a no-op — Set dedup, no callback fire", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    onChanged.mockClear();
    c.add("sess-A", "task-1"); // duplicate
    expect(c.sum()).toBe(1);
    expect(onChanged).not.toHaveBeenCalled();
    expect(onSessionDrained).not.toHaveBeenCalled();
  });

  it("multiple distinct ids in one session accumulate correctly", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    c.add("sess-A", "task-2");
    c.add("sess-A", "task-3");
    expect(c.sum()).toBe(3);
    expect(onChanged).toHaveBeenCalledTimes(3);
    expect(onChanged).toHaveBeenNthCalledWith(3, 3);
  });

  // ---- remove() — ignore unknown id ----

  it("remove of unknown id in unknown session is a debug-log no-op (no callback, no drift)", () => {
    const c = newCounter();
    c.remove("sess-unknown", "task-x");
    expect(c.sum()).toBe(0);
    expect(onChanged).not.toHaveBeenCalled();
    expect(onSessionDrained).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("sess-unk"));
  });

  it("remove of unknown id in a known session is a debug-log no-op (burst-bug fix)", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    onChanged.mockClear();
    c.remove("sess-A", "task-999"); // id not in the set
    expect(c.sum()).toBe(1);
    expect(onChanged).not.toHaveBeenCalled();
    expect(onSessionDrained).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining("task-999"));
  });

  it("remove of the same id twice — second remove is a no-op (set already shrank)", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    c.remove("sess-A", "task-1"); // drains session
    onSessionDrained.mockClear();
    onChanged.mockClear();
    c.remove("sess-A", "task-1"); // second remove — id not in set (session entry deleted)
    expect(c.sum()).toBe(0);
    expect(onChanged).not.toHaveBeenCalled();
    expect(onSessionDrained).not.toHaveBeenCalled();
  });

  // ---- drain ordering guarantee ----

  it("remove that drains a session fires onSessionDrained BEFORE onChanged(sum) — ordering guarantee", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    onChanged.mockClear();
    const callOrder: string[] = [];
    onSessionDrained.mockImplementation(() => callOrder.push("drained"));
    onChanged.mockImplementation(() => callOrder.push("changed"));
    c.remove("sess-A", "task-1");
    expect(callOrder).toEqual(["drained", "changed"]);
    expect(onSessionDrained).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith(0);
  });

  it("remove that does NOT drain session fires onChanged only, not onSessionDrained", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    c.add("sess-A", "task-2");
    onChanged.mockClear();
    c.remove("sess-A", "task-1"); // still 1 left
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith(1);
    expect(onSessionDrained).not.toHaveBeenCalled();
  });

  // ---- onSessionDrained is optional ----

  it("onSessionDrained omitted — drain completes silently with no throw", () => {
    const c = newCounter(false); // no drainCallback
    c.add("sess-A", "task-1");
    expect(() => c.remove("sess-A", "task-1")).not.toThrow();
    expect(c.sum()).toBe(0);
    expect(onChanged).toHaveBeenCalledWith(0);
  });

  // ---- reset() is silent ----

  it("reset(sessionId) deletes the session entry silently — no onSessionDrained, no onChanged if sum unchanged", () => {
    const c = newCounter();
    c.reset("sess-empty"); // no entry — complete no-op
    expect(onChanged).not.toHaveBeenCalled();
    expect(onSessionDrained).not.toHaveBeenCalled();
  });

  it("reset(sessionId) with existing tasks deletes entry and fires onChanged with new sum, not onSessionDrained", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    c.add("sess-A", "task-2");
    onChanged.mockClear();
    c.reset("sess-A");
    expect(c.sum()).toBe(0);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith(0);
    expect(onSessionDrained).not.toHaveBeenCalled();
  });

  it("reset only removes the named session — other sessions unaffected", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    c.add("sess-B", "task-2");
    c.add("sess-B", "task-3");
    onChanged.mockClear();
    c.reset("sess-A");
    expect(c.sum()).toBe(2); // only sess-B's 2 tasks remain
    expect(onChanged).toHaveBeenCalledWith(2);
  });

  // ---- cross-session sum ----

  it("sum() is the cross-session total", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    c.add("sess-B", "task-2");
    c.add("sess-B", "task-3");
    expect(c.sum()).toBe(3);
  });

  it("per-session drain fires onSessionDrained even when global sum > 0 (B drains while A still has tasks)", () => {
    const c = newCounter();
    c.add("sess-A", "task-A1");
    c.add("sess-A", "task-A2");
    c.add("sess-B", "task-B1");
    onSessionDrained.mockClear();
    onChanged.mockClear();
    c.remove("sess-B", "task-B1"); // B drains → onSessionDrained; sum drops to 2
    expect(onSessionDrained).toHaveBeenCalledTimes(1);
    expect(c.sum()).toBe(2);
    expect(onChanged).toHaveBeenCalledWith(2);
  });

  // ---- map hygiene ----

  it("session map entry is deleted when its set empties via remove()", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    c.remove("sess-A", "task-1"); // entry deleted
    // Re-add a new id in the same session — must work as a fresh entry (not find a stale set)
    onSessionDrained.mockClear();
    onChanged.mockClear();
    c.add("sess-A", "new-task");
    expect(c.sum()).toBe(1);
    // A fresh add must not trigger onSessionDrained
    expect(onSessionDrained).not.toHaveBeenCalled();
  });

  it("session map entry is deleted by reset()", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    c.reset("sess-A");
    expect(c.sum()).toBe(0);
    // Second reset for same session is a no-op
    onChanged.mockClear();
    c.reset("sess-A");
    expect(onChanged).not.toHaveBeenCalled();
  });

  // ---- thinking instance semantic: session_id as the id ----

  it("thinking-style use: add(sessionId, sessionId) and remove(sessionId, sessionId) — Set dedup keeps it at 1", () => {
    const c = newCounter();
    c.add("sess-A", "sess-A"); // thinking: id = sessionId itself
    c.add("sess-A", "sess-A"); // dedup
    expect(c.sum()).toBe(1);
    c.remove("sess-A", "sess-A");
    expect(c.sum()).toBe(0);
    expect(onSessionDrained).toHaveBeenCalledTimes(1);
  });

  // ---- burst scenario (the burst-bug fix) ----

  it("burst of completes for ids that no longer exist — all ignored, sum stays stable", () => {
    const c = newCounter();
    c.add("sess-A", "task-1");
    onChanged.mockClear();
    // Burst: 5 removes of ids that don't exist
    for (let i = 2; i <= 6; i++) c.remove("sess-A", `task-${i}`);
    expect(c.sum()).toBe(1); // only task-1 remains
    expect(onChanged).not.toHaveBeenCalled();
    expect(onSessionDrained).not.toHaveBeenCalled();
    // No warn spam — debug only
    expect(log.warn).not.toHaveBeenCalled();
  });
});
