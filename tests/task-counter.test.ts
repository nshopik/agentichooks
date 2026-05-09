import { describe, it, expect, beforeEach, vi } from "vitest";
import { TaskCounter } from "../src/task-counter.js";

let onCountChanged: ReturnType<typeof vi.fn>;
let onZeroReached: ReturnType<typeof vi.fn>;
let log: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onCountChanged = vi.fn();
  onZeroReached = vi.fn();
  log = vi.fn();
});

function newCounter() {
  return new TaskCounter({ onCountChanged, onZeroReached, log });
}

describe("TaskCounter", () => {
  it("starts at 0", () => {
    expect(newCounter().current()).toBe(0);
  });

  it("increment raises count and fires onCountChanged with new value", () => {
    const c = newCounter();
    c.increment();
    expect(c.current()).toBe(1);
    expect(onCountChanged).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledWith(1);
    expect(onZeroReached).not.toHaveBeenCalled();
  });

  it("decrement from >0 to >0 lowers count and fires onCountChanged only", () => {
    const c = newCounter();
    c.increment();
    c.increment();
    onCountChanged.mockClear();
    c.decrement();
    expect(c.current()).toBe(1);
    expect(onCountChanged).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledWith(1);
    expect(onZeroReached).not.toHaveBeenCalled();
  });

  it("decrement from >0 to 0 fires onZeroReached then onCountChanged(0) — order matters", () => {
    const c = newCounter();
    c.increment();
    onCountChanged.mockClear();
    const callOrder: string[] = [];
    onZeroReached.mockImplementation(() => callOrder.push("zero"));
    onCountChanged.mockImplementation(() => callOrder.push("count"));
    c.decrement();
    expect(c.current()).toBe(0);
    expect(callOrder).toEqual(["zero", "count"]);
    expect(onZeroReached).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledWith(0);
  });

  it("decrement at 0 floors, logs warn, fires no callbacks (drift case)", () => {
    const c = newCounter();
    c.decrement();
    expect(c.current()).toBe(0);
    expect(onCountChanged).not.toHaveBeenCalled();
    expect(onZeroReached).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("count=0"));
  });

  it("reset from >0 zeros count, fires onCountChanged(0), does NOT fire onZeroReached (silent)", () => {
    const c = newCounter();
    c.increment();
    c.increment();
    c.increment();
    onCountChanged.mockClear();
    c.reset();
    expect(c.current()).toBe(0);
    expect(onCountChanged).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledWith(0);
    expect(onZeroReached).not.toHaveBeenCalled();
  });

  it("reset at 0 is a no-op", () => {
    const c = newCounter();
    c.reset();
    expect(onCountChanged).not.toHaveBeenCalled();
    expect(onZeroReached).not.toHaveBeenCalled();
  });

  it("burst: 5 increments then 5 decrements ends at 0 with onZeroReached fired exactly once", () => {
    const c = newCounter();
    for (let i = 0; i < 5; i++) c.increment();
    for (let i = 0; i < 5; i++) c.decrement();
    expect(c.current()).toBe(0);
    expect(onZeroReached).toHaveBeenCalledTimes(1);
    expect(onCountChanged).toHaveBeenCalledTimes(10);
  });

  it("each increment fires its own onCountChanged (no batching)", () => {
    const c = newCounter();
    c.increment();
    c.increment();
    c.increment();
    expect(onCountChanged).toHaveBeenCalledTimes(3);
    expect(onCountChanged).toHaveBeenNthCalledWith(1, 1);
    expect(onCountChanged).toHaveBeenNthCalledWith(2, 2);
    expect(onCountChanged).toHaveBeenNthCalledWith(3, 3);
  });
});
