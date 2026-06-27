import type { EventType, GlobalSettings, FlashSettings, ButtonState, Logger } from "./types.js";
import { defaultSoundPath } from "./system-sounds.js";

export type DispatchableButton = {
  eventType: EventType;
  settings: FlashSettings;
  state: ButtonState;
  alert: () => void;
  dismiss: () => void;
};

// CounterMetric union — matrix vocabulary (NOT EventType).
// Declared here, next to RouteSpec, so the matrix and the interface stay in sync.
export type CounterMetric = "tasks" | "subagents" | "thinking";

// Minimal interface the dispatcher calls on each counter slot.
export type DispatcherCounter = {
  add(sessionId: string, id: string): void;
  remove(sessionId: string, id: string): void;
  reset(sessionId: string): void;
  // True when the session currently has >0 ids. Consulted only on the subagents
  // slot, to decide whether a Stop should be suppressed (subagents still running).
  has(sessionId: string): boolean;
};

export type DispatcherOpts = {
  audioPlayer: { play: (path: string) => void };
  getGlobalSettings: () => GlobalSettings;
  getButtons: () => Map<string, DispatchableButton>;
  log?: Logger;
  counters?: {
    tasks?: DispatcherCounter;
    subagents?: DispatcherCounter;
    thinking?: DispatcherCounter;
  };
  /**
   * Fires exactly once per ARMED-map mutation: inside fire() (arm or re-fire),
   * inside clearType() when it removes an armed entry, and inside dismissArmed()
   * when it wipes a non-empty map. Does NOT fire on PENDING entry — a session
   * in its delay window is invisible to the key-lit OR and to armedContext.
   */
  onArmedChanged?: (type: EventType) => void;
};

// Each incoming HTTP route maps to a set of event types whose alerts it clears
// and (optionally) the event type it arms. Apply order is clears-first then arm,
// so a fresh stop cancels stale permission/task-completed before entering its
// own pending window.
type CounterEntry = { metric: CounterMetric; op: "add" | "remove" | "reset" };
type RouteSpec = {
  clears: ReadonlyArray<EventType>;
  arms?: EventType;
  // Applied AFTER clears/arms. Missing-id gate in handleRoute prevents application
  // when any add/remove entry's required id is absent.
  counters?: ReadonlyArray<CounterEntry>;
};

export const SESSION_START_SOFT = "/event/session-start-soft";
export const TASK_COMPLETED_AGENT = "/event/task-completed-agent";
export const POST_TOOL_USE_FAILURE_INTERRUPT = "/event/post-tool-use-failure-interrupt";

// Backstop for a held Stop whose subagent drain never arrives — a lost
// subagent-stop, or one without agent_id (the missing-id gate drops it before
// applyCounters, so the subagents counter never reaches 0). Without this, the
// chime strands until the session's next resume (UserPromptSubmit/PreToolUse/
// session-start/-end). The safety timer releases the deferred chime after this
// interval regardless of counter state. Tradeoff: a legitimate subagent run
// longer than this fires the chime early (then the real drain is a no-op);
// firing early — once — beats never. Long enough to essentially never trip
// during normal orchestration; the strand self-heals on the next prompt anyway.
export const STOP_SAFETY_RELEASE_MS = 10 * 60 * 1000;

// Closed key set for the matrix. Record<Route, RouteSpec> makes a typo'd or
// missing key a compile error instead of a silent runtime no-op; unknown
// runtime strings still take the isKnownRoute guard path in handleRoute.
type Route =
  | "/event/stop"
  | "/event/stop-failure"
  | "/event/permission-request"
  | "/event/task-created"
  | "/event/task-completed"
  | "/event/subagent-start"
  | "/event/subagent-stop"
  | "/event/session-start"
  | "/event/session-end"
  | "/event/user-prompt-submit"
  | "/event/permission-denied"
  | "/event/post-tool-use"
  | "/event/post-tool-use-failure"
  | "/event/pre-tool-use"
  | typeof SESSION_START_SOFT
  | typeof TASK_COMPLETED_AGENT
  | typeof POST_TOOL_USE_FAILURE_INTERRUPT;

function isKnownRoute(route: string): route is Route {
  return Object.hasOwn(ROUTES, route);
}

const ROUTES: Readonly<Record<Route, RouteSpec>> = {
  "/event/stop":                  { arms: "stop",       clears: ["permission", "task-completed"], counters: [{ metric: "thinking", op: "remove" }] },
  "/event/stop-failure":          { arms: "stop",       clears: ["permission", "task-completed"], counters: [{ metric: "thinking", op: "remove" }] },
  "/event/permission-request":    { arms: "permission", clears: [] },
  // Clears task-completed so a fresh task arriving during the post-zero alert (or its 1s
  // pre-fire delay) dismisses the alert immediately and lets the in-flight count visual
  // take over — without this, the count "1" only appears after the 30s auto-timeout.
  "/event/task-created":          {                     clears: ["task-completed"],                counters: [{ metric: "tasks", op: "add" }] },
  // arms: "task-completed" REMOVED — arming is now indirect, driven by
  // SessionSetCounter (tasks instance) onSessionDrained → dispatcher.fireTaskCompleted().
  "/event/task-completed":        {                     clears: ["permission"],                   counters: [{ metric: "tasks", op: "remove" }] },
  // Synthetic agent-only routes — always routed here via deriveRoute (agentId present).
  // Counter-only: no alert state change.
  "/event/subagent-start":        {                     clears: [],                               counters: [{ metric: "subagents", op: "add" }] },
  "/event/subagent-stop":         {                     clears: [],                               counters: [{ metric: "subagents", op: "remove" }] },
  "/event/session-start":         {                     clears: ["stop", "permission", "task-completed"], counters: [{ metric: "tasks", op: "reset" }, { metric: "subagents", op: "reset" }, { metric: "thinking", op: "reset" }] },
  "/event/session-end":           {                     clears: ["stop", "permission", "task-completed"], counters: [{ metric: "tasks", op: "reset" }, { metric: "subagents", op: "reset" }, { metric: "thinking", op: "reset" }] },
  "/event/user-prompt-submit":    {                     clears: ["stop", "permission", "task-completed"], counters: [{ metric: "thinking", op: "add" }] },
  "/event/permission-denied":     {                     clears: ["permission"] },
  "/event/post-tool-use":         {                     clears: ["permission"] },
  "/event/post-tool-use-failure": {                     clears: ["permission"] },
  // The agentic loop can restart after Stop without a UserPromptSubmit (auto-continue,
  // /continue, compact-and-continue). A fresh PreToolUse means the agent is working
  // again, so a still-armed stop alert is stale.
  "/event/pre-tool-use":          {                     clears: ["stop"] },
  // Synthetic route — never registered in ACTION_ROUTES (a direct POST 404s).
  // Reachable only via deriveRoute() for SessionStart source=compact|resume:
  // mid-run compaction / resume must not clear alerts or reset the counter.
  [SESSION_START_SOFT]:           {                     clears: [] },
  // Synthetic route — never in ACTION_ROUTES (a direct POST 404s). Reachable only
  // via deriveRoute() for agent-context TaskCompleted: teammate completions drive
  // the counter but must not clear the user's armed permission alert.
  [TASK_COMPLETED_AGENT]:         {                     clears: [],                               counters: [{ metric: "tasks", op: "remove" }] },
  // Synthetic route — never in ACTION_ROUTES (a direct POST 404s). Reachable only
  // via deriveRoute() for a PostToolUseFailure carrying is_interrupt (user Esc during
  // a tool call). No Stop hook fires on interrupts, so this is the only chance to
  // drop the session from the thinking counter — otherwise the sparkle/timer run
  // until the next prompt. Mirrors the base post-tool-use-failure clear (permission)
  // and adds thinking.remove on top.
  [POST_TOOL_USE_FAILURE_INTERRUPT]: {                  clears: ["permission"],                   counters: [{ metric: "thinking", op: "remove" }] },
};

// Maps an incoming route + body fields to the effective ROUTES key, or null (drop).
//
// Admission policy — evaluated in this order:
//   1. Session gate (FIRST): sessionId falsy → null. Applies to every action route
//      without exception, including task-created / task-completed — real Claude Code
//      hooks always carry session_id, so the counter never sees gated traffic.
//   2. Agent context: agentId present + route is /event/task-created,
//      /event/subagent-start, or /event/subagent-stop → passthrough (these are
//      always agent-context events). agentId present + route is /event/task-completed
//      → TASK_COMPLETED_AGENT (counter-only). agentId present, any other route → null
//      (drop; caller must not call handleRoute).
//   3. Source derivation: agentId absent → source logic. session-start with
//      source=compact|resume → SESSION_START_SOFT (no-op). post-tool-use-failure
//      with isInterrupt → POST_TOOL_USE_FAILURE_INTERRUPT (also clears thinking).
//      Everything else → route. Never returns null in this branch.
//
// NOTE: sessionId is a REQUIRED parameter (no `?`, no default) so the TypeScript
// compiler forces every call site — production and test — to state explicitly what
// session context they pass. Callers that want to express "no session" pass `undefined`.
// The check is a falsy guard (`!sessionId`), so `""` is treated as absent.
export function deriveRoute(route: string, source: string | undefined, agentId: string | undefined, sessionId: string | undefined, isInterrupt?: boolean): string | null {
  // 1. Session gate — evaluated FIRST.
  if (!sessionId) return null;
  // 2. Agent-context check. A subagent's interrupting PostToolUseFailure carries
  //    agent_id and is dropped here (not in the passthrough set), so the interrupt
  //    derivation below is reached only by main-thread interrupts.
  if (agentId !== undefined) {
    if (
      route === "/event/task-created" ||
      route === "/event/subagent-start" ||
      route === "/event/subagent-stop"
    ) return route;
    if (route === "/event/task-completed") return TASK_COMPLETED_AGENT;
    return null;
  }
  // 3. Source derivation.
  if (route === "/event/session-start" && (source === "compact" || source === "resume")) {
    return SESSION_START_SOFT;
  }
  // A user interrupt (Esc) during a tool call is the only interrupt signal we get —
  // Stop hooks do not fire on interrupts — so route it to the synthetic variant that
  // clears the thinking counter. Does NOT cover Esc during pure thinking/streaming
  // (no tool call in flight → no PostToolUseFailure fires).
  if (route === "/event/post-tool-use-failure" && isInterrupt === true) {
    return POST_TOOL_USE_FAILURE_INTERRUPT;
  }
  return route;
}

// Per-session armed entry: timestamp and cwd captured when this session's alert fired.
type ArmedEntry = { armedAt: number; cwd: string | null };

export class Dispatcher {
  private opts: DispatcherOpts;
  // pending: per-session delay timers, keyed by EventType → sessionId → timer handle.
  // Prune-on-empty invariant: when the last sessionId entry is removed from an inner
  // Map, the inner Map is deleted from the outer Map. This makes "nothing pending for
  // this type" representable as `pending.get(type) === undefined` with no edge case.
  private pending = new Map<EventType, Map<string, NodeJS.Timeout>>();
  // ARMED state lives on the dispatcher, not on the visible buttons. Stream Deck
  // tears down (willDisappear) and rebuilds (willAppear) per-key contexts on every
  // page or profile switch, which would otherwise wipe alerting state. Tracking
  // armed types here lets onWillAppear restore the visual + remaining timeout.
  //
  // armed: per-session armed entries, keyed by EventType → sessionId → ArmedEntry.
  // Prune-on-empty invariant: same as pending — an inner Map is deleted when empty,
  // so `armed.get(type) === undefined` means "nothing armed for this type."
  private armed = new Map<EventType, Map<string, ArmedEntry>>();

  // Sessions whose Stop was suppressed because subagents were still in flight,
  // keyed sessionId → { cwd captured at suppression time (for the deferred
  // alert's title), safetyTimer }. The entry is consumed by fireDeferredStop()
  // when the subagents counter drains to 0, or dropped by any stop-clearing
  // route / keypress (clearType("stop") / dismissArmed("stop")). Suppression is
  // silent — no visual stand-in; the key simply stays idle until the deferred
  // chime fires. safetyTimer is the STOP_SAFETY_RELEASE_MS backstop that fires
  // the deferred chime if the subagent drain never arrives; every drop path must
  // cancel it (via dropDeferredStop) so it can't double-fire or leak.
  private deferredStops = new Map<string, { cwd: string | null; safetyTimer: NodeJS.Timeout }>();

  constructor(opts: DispatcherOpts) {
    this.opts = opts;
  }

  // Single matrix-driven entry point. Replaces dispatch / dismiss / dismissAll.
  // For each event type, the dispatcher tracks one of three states:
  //   IDLE     — nothing pending, not armed
  //   PENDING  — delay timer running; will fire (audio + flash) on expiry
  //   ARMED    — delay elapsed; alert is active for this type (independent of
  //              whether any button is currently visible to render it)
  // Same-session same-type arm during PENDING is a deliberate no-op (timer keeps
  // running, no extension), so a burst of arming events from one session still
  // produces exactly one alert. Different sessions each get independent timers.
  handleRoute(route: string, sessionId: string, ctx?: { taskId?: string; agentId?: string; cwd?: string }): void {
    if (!isKnownRoute(route)) {
      this.opts.log?.debug(`unknown route=${route}`);
      return; // no state change; skip trace dump
    }
    const spec = ROUTES[route];

    // Missing-id gate — runs BEFORE clears and arms.
    // If any counters entry with op add/remove has no matching id, the entire
    // route is dropped (no clears, no arms, no counter application). Rationale:
    // task-created without task_id must not fire clears: ["task-completed"] while
    // adding nothing (silent dismissal of an armed all-done alert).
    if (spec.counters) {
      for (const entry of spec.counters) {
        if (entry.op === "reset") continue;
        const id = this.resolveId(entry.metric, sessionId, ctx);
        if (id === undefined) {
          this.opts.log?.warn(`drop missing-id route=${route} metric=${entry.metric}`);
          return;
        }
      }
    }

    this.opts.log?.debug(
      `handleRoute route=${route} session=${sessionId.slice(0, 8)} clears=${spec.clears.join(",") || "-"} arms=${spec.arms ?? "-"} counters=${spec.counters?.map((e) => `${e.metric}.${e.op}`).join(",") ?? "-"}`
    );
    for (const t of spec.clears) this.clearType(t, sessionId);
    if (spec.arms) {
      // Stop suppression: a Stop while this session still has in-flight subagents
      // is premature — hold the chime/flash silently. The held alert fires later
      // via fireDeferredStop() when the subagents counter drains. Only the arm is
      // suppressed; clears (above) and counters (below) still run.
      if (spec.arms === "stop" && this.subagentsInFlight(sessionId)) {
        this.suppressStop(sessionId, ctx?.cwd ?? null);
      } else {
        this.armType(spec.arms, sessionId, ctx?.cwd ?? null);
      }
    }
    if (spec.counters) this.applyCounters(spec.counters, sessionId, ctx);
    this.opts.log?.trace(`state stop=${this.stateOf("stop", sessionId)} permission=${this.stateOf("permission", sessionId)} task-completed=${this.stateOf("task-completed", sessionId)} stop-held=${this.deferredStops.has(sessionId)}`);
  }

  // Public seam used by SessionSetCounter (tasks instance) onSessionDrained. Wraps the
  // existing private armType so external callers can fire only the task-completed
  // alert and cannot bypass the matrix for arbitrary types.
  fireTaskCompleted(sessionId: string): void {
    this.armType("task-completed", sessionId, null);
  }

  private subagentsInFlight(sessionId: string): boolean {
    return this.opts.counters?.subagents?.has(sessionId) ?? false;
  }

  // Records a held Stop for this session (silent — no visual). Latest cwd wins
  // on repeated suppression (intermediate Stops during one orchestration); the
  // backstop timer restarts each time so the safety window tracks the latest Stop.
  private suppressStop(sessionId: string, cwd: string | null): void {
    // Re-suppression: cancel the prior backstop so we don't leak a stray timer.
    const prior = this.deferredStops.get(sessionId);
    if (prior) clearTimeout(prior.safetyTimer);
    const safetyTimer = setTimeout(() => {
      this.opts.log?.warn(`safety-release held stop (subagent drain never arrived) session=${sessionId.slice(0, 8)}`);
      this.fireDeferredStop(sessionId);
    }, STOP_SAFETY_RELEASE_MS);
    this.deferredStops.set(sessionId, { cwd, safetyTimer });
    this.opts.log?.info(`suppress stop (subagents in-flight) session=${sessionId.slice(0, 8)} deferred=${this.deferredStops.size}`);
  }

  // Cancels the safety timer and removes the held-stop entry. Idempotent — the
  // single sanctioned way to drop a held Stop, so the backstop timer can never
  // outlive its entry. Returns the dropped cwd, or undefined if none was held.
  private dropDeferredStop(sessionId: string): { cwd: string | null } | undefined {
    const entry = this.deferredStops.get(sessionId);
    if (!entry) return undefined;
    clearTimeout(entry.safetyTimer);
    this.deferredStops.delete(sessionId);
    return { cwd: entry.cwd };
  }

  /**
   * Public seam wired to the subagents SessionSetCounter onSessionDrained.
   * If this session has a held Stop (suppressed because subagents were running),
   * drop it and arm the stop alert now — the deferred chime. No-op when the
   * session has no held Stop (e.g. a stop-clearing route already consumed it, or
   * the Stop never raced ahead of the subagent-stops).
   */
  fireDeferredStop(sessionId: string): void {
    const held = this.dropDeferredStop(sessionId);
    if (!held) return;
    const cwd = held.cwd;
    this.opts.log?.info(`fire deferred stop on subagent drain session=${sessionId.slice(0, 8)} remaining=${this.deferredStops.size}`);
    // Replay the stop route's clears so the deferred completion behaves exactly
    // like a real Stop: a permission or task-completed alert that re-armed during
    // the hold window (e.g. the tasks counter drained while subagents still ran)
    // is dismissed, instead of lingering behind the chime.
    for (const t of ROUTES["/event/stop"].clears) this.clearType(t, sessionId);
    this.armType("stop", sessionId, cwd);
  }

  /**
   * Public seam used by the action layer when a user keypress or per-button
   * auto-timeout dismisses an alert. Clears ARMED state for the given event
   * type across ALL sessions and dismisses every currently-alerting button of
   * that type.
   *
   * Alert-only scope: does NOT touch the SessionSetCounter instances or the in-flight
   * count visual. Covers all three dispatcher states: IDLE (no-op on dispatcher state;
   * still dismisses stray alerting visuals), PENDING (cancels every per-session timer
   * so the alert never fires), ARMED (clears all session entries + visuals).
   * Mirrors the fireTaskCompleted() pattern: a narrow public seam that cannot bypass
   * the route matrix for arbitrary state.
   */
  dismissArmed(type: EventType): void {
    this.opts.log?.debug(`dismissArmed type=${type}`);
    // A keypress / auto-timeout on the stop key is type-wide: also drop every
    // held Stop so a dismissed key cannot resurrect a deferred chime. Cancel each
    // session's backstop timer before clearing so no orphaned timer fires later.
    if (type === "stop") {
      for (const entry of this.deferredStops.values()) clearTimeout(entry.safetyTimer);
      this.deferredStops.clear();
    }
    // Iterate and cancel ALL per-session pending timers for this type.
    // TRAP: after the re-key, this.pending.get(type) is a Map<sessionId, Timeout>,
    // and clearTimeout(someMap) is a silent no-op in Node — we MUST iterate.
    for (const timer of this.pending.get(type)?.values() ?? []) clearTimeout(timer);
    this.pending.delete(type);
    const hadArmed = this.armed.delete(type); // wipes entire inner map
    for (const [, btn] of this.opts.getButtons()) {
      if (btn.state.alerting && btn.eventType === type) btn.dismiss();
    }
    if (hadArmed) this.opts.onArmedChanged?.(type);
  }

  private resolveId(metric: CounterMetric, sessionId: string, ids?: { taskId?: string; agentId?: string }): string | undefined {
    if (metric === "tasks") return ids?.taskId;
    if (metric === "subagents") return ids?.agentId;
    if (metric === "thinking") return sessionId; // thinking id IS the sessionId
    return undefined;
  }

  private applyCounters(
    entries: ReadonlyArray<CounterEntry>,
    sessionId: string,
    ids?: { taskId?: string; agentId?: string }
  ): void {
    const c = this.opts.counters;
    if (!c) return;
    for (const entry of entries) {
      const slot = c[entry.metric];
      if (!slot) continue;
      if (entry.op === "reset") {
        slot.reset(sessionId);
      } else {
        const id = this.resolveId(entry.metric, sessionId, ids);
        if (id === undefined) continue; // gate already ran; this path is unreachable in production
        if (entry.op === "add") slot.add(sessionId, id);
        else slot.remove(sessionId, id);
      }
    }
  }

  // Public lookup for EventFlashAction.onWillAppear: returns ms since the latest
  // session was armed for this type, or null if no sessions are armed.
  // Latest-wins: uses the greatest armedAt across all armed sessions, consistent
  // with armedContext. Null when no armed entries; prune-on-empty makes "empty but
  // present" inner Map unrepresentable, guarding the Math.max(...[]) === -Infinity trap.
  armedMsAgo(type: EventType): number | null {
    const inner = this.armed.get(type);
    if (!inner) return null;
    let maxAt = -Infinity;
    for (const { armedAt } of inner.values()) {
      if (armedAt > maxAt) maxAt = armedAt;
    }
    return Date.now() - maxAt;
  }

  /**
   * Public lookup used by OnStopAction/OnPermissionAction to compute the key title.
   * Returns null when nothing is armed (no inner Map); otherwise { count, latestCwd }
   * where count = number of armed sessions, latestCwd = the latest session's cwd
   * (determined by greatest armedAt, consistent with armedMsAgo latest-wins).
   */
  armedContext(type: EventType): { count: number; latestCwd: string | null } | null {
    const inner = this.armed.get(type);
    if (!inner) return null;
    let maxAt = -Infinity;
    let latestCwd: string | null = null;
    for (const entry of inner.values()) {
      if (entry.armedAt > maxAt) {
        maxAt = entry.armedAt;
        latestCwd = entry.cwd;
      }
    }
    return { count: inner.size, latestCwd };
  }

  private stateOf(type: EventType, sessionId: string): "IDLE" | "PENDING" | "ARMED" {
    if (this.pending.get(type)?.has(sessionId)) return "PENDING";
    if (this.armed.get(type)?.has(sessionId)) return "ARMED";
    return "IDLE";
  }

  // Per-session clear: cancels this session's pending timer (if any) and removes
  // this session's armed entry (if any). Prunes empty inner maps.
  // Button dismiss loop runs when the entire type's armed map is idle (empty or
  // was never populated) — so the key stays lit while other sessions are still armed.
  // Fires onArmedChanged iff an armed entry was actually removed.
  private clearType(type: EventType, sessionId: string): void {
    // A stop-clearing route (user-prompt-submit, session-start/end, pre-tool-use)
    // means the agent resumed or the session reset — any held Stop is now stale.
    // Load-bearing ordering: session-start/end ALSO reset the subagents counter,
    // but reset() is silent (no onSessionDrained), so this clear — which runs in
    // the clears phase, BEFORE counters — is what drops the held Stop. Without it,
    // a session boundary would strand the held Stop instead of cancelling it.
    if (type === "stop") this.dropDeferredStop(sessionId);
    const pendingInner = this.pending.get(type);
    if (pendingInner) {
      const timer = pendingInner.get(sessionId);
      if (timer) {
        clearTimeout(timer);
        pendingInner.delete(sessionId);
        if (pendingInner.size === 0) this.pending.delete(type); // prune-on-empty
      }
    }
    const armedInner = this.armed.get(type);
    let removedArmed = false;
    if (armedInner) {
      if (armedInner.has(sessionId)) {
        armedInner.delete(sessionId);
        removedArmed = true;
      }
      if (removedArmed && armedInner.size === 0) {
        this.armed.delete(type); // prune-on-empty
      }
      // Else: other sessions still armed — key stays lit, only title updates via onArmedChanged.
    }
    // Dismiss alerting buttons whenever the type is fully idle (no armed sessions remain,
    // whether because we just cleared the last entry or because there were never any
    // dispatcher-tracked entries — e.g. buttons created with alerting=true in tests or
    // via onWillAppear restoring visual state without re-arming through dispatcher).
    if (this.armed.get(type) === undefined) {
      for (const [, btn] of this.opts.getButtons()) {
        if (btn.state.alerting && btn.eventType === type) btn.dismiss();
      }
    }
    if (removedArmed) this.opts.onArmedChanged?.(type);
  }

  private armType(type: EventType, sessionId: string, cwd: string | null): void {
    // This session PENDING for the type → no-op (timer keeps running, no extension;
    // burst of arms from one session = one alert, per existing rule).
    if (this.pending.get(type)?.has(sessionId)) {
      this.opts.log?.debug(`arm skip: type=${type} session=${sessionId.slice(0, 8)} already PENDING`);
      return;
    }
    // This session ARMED → re-fire (audio replay, pulse restart, armedAt/cwd refresh).
    if (this.armed.get(type)?.has(sessionId)) {
      this.fire(type, sessionId, cwd);
      return;
    }
    // Otherwise → start this session's own delay timer.
    const delayMs = this.opts.getGlobalSettings().alertDelay[type];
    if (delayMs <= 0) {
      this.fire(type, sessionId, cwd);
      return;
    }
    let inner = this.pending.get(type);
    if (!inner) {
      inner = new Map<string, NodeJS.Timeout>();
      this.pending.set(type, inner);
    }
    const timer = setTimeout(() => {
      inner!.delete(sessionId);
      if (inner!.size === 0) this.pending.delete(type); // prune-on-empty
      this.fire(type, sessionId, cwd);
    }, delayMs);
    inner.set(sessionId, timer);
    this.opts.log?.info(`pending type=${type} session=${sessionId.slice(0, 8)} delayMs=${delayMs}`);
  }

  private fire(type: EventType, sessionId: string, cwd: string | null): void {
    const buttons = this.opts.getButtons();
    let dismissed = 0;
    let armed = 0;
    // Dismiss any currently-alerting buttons of this type before re-alerting
    // (pulse restart: dismiss prior visual state, then re-arm).
    for (const [, btn] of buttons) {
      if (btn.state.alerting && btn.eventType === type) {
        btn.dismiss();
        dismissed++;
      }
    }
    for (const [, btn] of buttons) {
      if (btn.eventType === type) {
        btn.alert();
        armed++;
      }
    }
    let inner = this.armed.get(type);
    if (!inner) {
      inner = new Map<string, ArmedEntry>();
      this.armed.set(type, inner);
    }
    inner.set(sessionId, { armedAt: Date.now(), cwd });
    const audioCfg = this.opts.getGlobalSettings().audio[type];
    const path = audioCfg.soundPath ?? defaultSoundPath(type);
    this.opts.log?.info(`fire type=${type} session=${sessionId.slice(0, 8)} buttons=${buttons.size} dismissed=${dismissed} armed=${armed} audio=${path ? "yes" : "no"}`);
    if (path) this.opts.audioPlayer.play(path);
    // fire() is the single ARMED-map mutation point for arms — fire onArmedChanged.
    this.opts.onArmedChanged?.(type);
  }
}
