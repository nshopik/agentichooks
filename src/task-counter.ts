import type { Logger } from "./types.js";

export type TaskCounterOpts = {
  onCountChanged: (count: number) => void;
  onZeroReached: () => void;
  log?: Logger;
};

// Per-session in-flight subagent counter.
//
// Holds Map<sessionId, number>. The public API surface (current(), onCountChanged,
// onZeroReached) is unchanged in meaning: current() returns the cross-session sum;
// onCountChanged receives the sum; onZeroReached fires when a *session's* count
// crosses >0 → 0 (not the global sum) so the "all done" chime fires per-session.
//
// Map hygiene: a session's entry is deleted when its count reaches 0 (decrement),
// when it is reset() explicitly (session-start / session-end), or on session-end.
// No LRU or TTL — a session that dies without session-end leaks one entry until
// plugin restart (acceptable; the floor-warn path notes it).
//
// Drift handling: decrement for an unknown session (or one already at 0) floors
// at 0, emits a warn log including the first 8 chars of the sessionId, and returns
// without firing any callbacks.
export class TaskCounter {
  private sessions = new Map<string, number>();
  private readonly opts: TaskCounterOpts;

  constructor(opts: TaskCounterOpts) {
    this.opts = opts;
  }

  private sum(): number {
    let total = 0;
    for (const n of this.sessions.values()) total += n;
    return total;
  }

  current(): number {
    return this.sum();
  }

  increment(sessionId: string): void {
    const prev = this.sessions.get(sessionId) ?? 0;
    this.sessions.set(sessionId, prev + 1);
    const s = this.sum();
    this.opts.log?.info(`increment session=${sessionId.slice(0, 8)} session-count=${prev + 1} sum=${s}`);
    this.opts.onCountChanged(s);
  }

  // Order on session >0 → 0 transition: onZeroReached first (so the dispatcher's
  // armed state is set before the visual layer queries it), then onCountChanged(sum)
  // (so the in-flight image is updated after).
  decrement(sessionId: string): void {
    const prev = this.sessions.get(sessionId);
    if (prev === undefined || prev === 0) {
      this.opts.log?.warn(
        `task-completed received with count=0 for session=${sessionId.slice(0, 8)} — floored, no alert`
      );
      return;
    }
    const next = prev - 1;
    if (next === 0) {
      this.sessions.delete(sessionId);
    } else {
      this.sessions.set(sessionId, next);
    }
    const s = this.sum();
    this.opts.log?.info(`decrement session=${sessionId.slice(0, 8)} session-count=${next} sum=${s}`);
    if (next === 0) {
      this.opts.log?.debug(`onZeroReached firing session=${sessionId.slice(0, 8)}`);
      this.opts.onZeroReached();
    }
    this.opts.onCountChanged(s);
  }

  // Silent per-session reset — no onZeroReached fire even from >0. Use case:
  // explicit session boundary (SessionStart / SessionEnd hooks). The user did
  // not complete the prior session's run so an "all done" alert would be
  // misleading. Recomputes and broadcasts the sum only if the session had tasks.
  reset(sessionId: string): void {
    const prev = this.sessions.get(sessionId);
    if (prev === undefined || prev === 0) return;
    this.sessions.delete(sessionId);
    const s = this.sum();
    this.opts.log?.info(`reset session=${sessionId.slice(0, 8)} sum=${s}`);
    this.opts.onCountChanged(s);
  }
}
