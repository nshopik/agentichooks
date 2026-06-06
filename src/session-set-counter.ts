import type { Logger } from "./types.js";

export type SessionSetCounterOpts = {
  onChanged: (sum: number) => void;
  // Optional — only the "tasks" instance wires this. Fires when remove() takes
  // a session's set from >0 to 0 BEFORE onChanged(sum), so the dispatcher's
  // armed state is set before the visual layer queries it.
  onSessionDrained?: () => void;
  log?: Logger;
};

// Per-session id-set counter.
//
// Holds Map<sessionId, Set<id>>. add() is Set-dedup safe (repeated add of the
// same id is a no-op). remove() of an unknown id is a debug-log ignore — the
// burst-bug fix: TaskCompleted bursts remove ids exactly once or are silently
// ignored without floor-warn spam.
//
// Map hygiene: a session's entry is deleted when its set empties (remove or reset).
// A session that dies without session-end leaks one entry until plugin restart
// (accepted).
//
// Three instances in plugin.ts:
//   tasks     — id=task_id;   onSessionDrained → dispatcher.fireTaskCompleted()
//   subagents — id=agent_id;  no onSessionDrained (subagent drain never chimes)
//   thinking  — id=sessionId; no onSessionDrained (thinking drain is silent)
export class SessionSetCounter {
  private sessions = new Map<string, Set<string>>();
  private readonly opts: SessionSetCounterOpts;

  constructor(opts: SessionSetCounterOpts) {
    this.opts = opts;
  }

  sum(): number {
    let total = 0;
    for (const s of this.sessions.values()) total += s.size;
    return total;
  }

  add(sessionId: string, id: string): void {
    let set = this.sessions.get(sessionId);
    if (!set) {
      set = new Set<string>();
      this.sessions.set(sessionId, set);
    }
    if (set.has(id)) return; // dedup — no callback
    set.add(id);
    const s = this.sum();
    this.opts.log?.debug(`add metric session=${sessionId.slice(0, 8)} id=${id.slice(0, 8)} set-size=${set.size} sum=${s}`);
    this.opts.onChanged(s);
  }

  remove(sessionId: string, id: string): void {
    const set = this.sessions.get(sessionId);
    if (!set || !set.has(id)) {
      this.opts.log?.debug(`remove ignore: session=${sessionId.slice(0, 8)} id=${id.slice(0, 8)} (not in set)`);
      return;
    }
    set.delete(id);
    if (set.size === 0) {
      this.sessions.delete(sessionId);
      const s = this.sum();
      this.opts.log?.debug(`remove drain session=${sessionId.slice(0, 8)} sum=${s}`);
      // Drain: onSessionDrained BEFORE onChanged — so dispatcher.fireTaskCompleted()
      // sets ARMED state before the visual layer's onChanged queries sum/armed.
      this.opts.onSessionDrained?.();
      this.opts.onChanged(s);
    } else {
      const s = this.sum();
      this.opts.log?.debug(`remove session=${sessionId.slice(0, 8)} id=${id.slice(0, 8)} set-size=${set.size} sum=${s}`);
      this.opts.onChanged(s);
    }
  }

  // Silent per-session reset — no onSessionDrained fire even from >0.
  // Fires onChanged only when the session had entries (sum actually changed).
  reset(sessionId: string): void {
    const set = this.sessions.get(sessionId);
    if (!set || set.size === 0) return;
    this.sessions.delete(sessionId);
    const s = this.sum();
    this.opts.log?.debug(`reset session=${sessionId.slice(0, 8)} sum=${s}`);
    this.opts.onChanged(s);
  }
}
