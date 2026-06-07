import type { DispatcherCounter } from "./dispatcher.js";

export type TurnClockOpts = {
  inner: DispatcherCounter;
  // Injectable for tests; defaults to Date.now.
  // The audio-player injected-spawn DI precedent.
  now?: () => number;
};

// TurnClock implements DispatcherCounter as a decorator over the thinking
// SessionSetCounter slot. It records per-session start timestamps using an
// insertion-ordered Map so the last-inserted still-running session can be
// identified for display (latest-wins per spec decision 5).
//
// Invariants:
//   - A session entry exists in the Map iff the session is currently tracked.
//   - Duplicate add()s for an already-tracked session REFRESH the timestamp but
//     are no-ops on the Map position (Map.set on an existing key preserves
//     insertion order). Rationale: Esc-cancel fires no hook (Stop skips user
//     interrupts), so a resubmit arrives as a duplicate add with a stale start —
//     without the refresh the timer shows unbounded idle wall-clock time. The
//     cost is bounded: a queued prompt mid-turn restarts the timer (time since
//     latest input), but never steals the display from a newer session.
//   - Delegation to inner always happens.
//   - Timestamp is recorded BEFORE delegating to inner.add, so that any
//     synchronous callback fired by inner.add (e.g. broadcastThinking → repaint)
//     already sees the clock entry via currentElapsedMs().
export class TurnClock implements DispatcherCounter {
  private readonly inner: DispatcherCounter;
  private readonly now: () => number;
  // Insertion-ordered: last entry = last-inserted still-tracked session = displayed.
  private readonly sessions = new Map<string, number>();

  constructor(opts: TurnClockOpts) {
    this.inner = opts.inner;
    this.now = opts.now ?? Date.now;
  }

  add(sessionId: string, id: string): void {
    // Unconditional set: refreshes the timestamp on duplicate add (cancel-resubmit
    // gap — no hook fires on user interrupt) while preserving Map position for an
    // already-tracked session (Map.set on an existing key keeps insertion order).
    // Record timestamp BEFORE delegating — inner.add may synchronously fire
    // broadcastThinking → repaint, which calls currentElapsedMs().
    this.sessions.set(sessionId, this.now());
    // Always delegate: the inner counter manages its own Set dedup.
    this.inner.add(sessionId, id);
  }

  remove(sessionId: string, id: string): void {
    this.sessions.delete(sessionId);
    this.inner.remove(sessionId, id);
  }

  reset(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.inner.reset(sessionId);
  }

  // Returns elapsed ms for the last-inserted still-tracked session, or null
  // when no sessions are tracked. "Last-inserted" is defined by Map insertion
  // order — the spec's latest-wins semantic (decision 5).
  currentElapsedMs(): number | null {
    if (this.sessions.size === 0) return null;
    // Map iteration order is insertion order; the last entry is at the end.
    let lastStartMs = 0;
    for (const startMs of this.sessions.values()) {
      lastStartMs = startMs;
    }
    return this.now() - lastStartMs;
  }
}
