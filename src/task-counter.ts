import type { Logger } from "./types.js";

export type TaskCounterOpts = {
  onCountChanged: (count: number) => void;
  onZeroReached: () => void;
  log?: Logger;
};

// Single shared in-flight subagent counter for the Task Completed action.
//
// Pure state + callbacks: no Stream Deck imports, no timers, no I/O. The
// dispatcher drives mutations via increment/decrement/reset; consumers
// (action layer, dispatcher) react via the two callbacks.
//
// Drift handling: decrement at 0 floors (no negative count) and emits a
// warn-level log line. The counter never zeros itself on a timer; the only
// resets are explicit (reset()) — wired in production to /event/session-start.
export class TaskCounter {
  private count = 0;
  private readonly opts: TaskCounterOpts;

  constructor(opts: TaskCounterOpts) {
    this.opts = opts;
  }

  current(): number {
    return this.count;
  }

  increment(): void {
    this.count++;
    this.opts.log?.info(`increment count=${this.count}`);
    this.opts.onCountChanged(this.count);
  }

  // Order on >0 → 0 transition: onZeroReached first (so the dispatcher's
  // armed state is set before the visual layer queries it), then
  // onCountChanged(0) (so the in-flight image is cleared after).
  decrement(): void {
    if (this.count === 0) {
      this.opts.log?.warn("task-completed received with count=0 — floored, no alert");
      return;
    }
    this.count--;
    this.opts.log?.info(`decrement count=${this.count}`);
    if (this.count === 0) {
      this.opts.log?.debug("onZeroReached firing");
      this.opts.onZeroReached();
    }
    this.opts.onCountChanged(this.count);
  }

  // Silent reset — no onZeroReached fire even from >0. Use case: explicit
  // session boundary (Claude Code SessionStart hook); the user did not
  // complete the prior run so an "all done" alert would be misleading.
  reset(): void {
    if (this.count === 0) return;
    this.count = 0;
    this.opts.log?.info("reset");
    this.opts.onCountChanged(0);
  }
}
