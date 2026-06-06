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
  | typeof TASK_COMPLETED_AGENT;

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
//      source=compact|resume → SESSION_START_SOFT (no-op). Everything else → route.
//      Never returns null in this branch.
//
// NOTE: sessionId is a REQUIRED parameter (no `?`, no default) so the TypeScript
// compiler forces every call site — production and test — to state explicitly what
// session context they pass. Callers that want to express "no session" pass `undefined`.
// The check is a falsy guard (`!sessionId`), so `""` is treated as absent.
export function deriveRoute(route: string, source: string | undefined, agentId: string | undefined, sessionId: string | undefined): string | null {
  // 1. Session gate — evaluated FIRST.
  if (!sessionId) return null;
  // 2. Agent-context check.
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
  return route;
}

export class Dispatcher {
  private opts: DispatcherOpts;
  private pending = new Map<EventType, NodeJS.Timeout>();
  // ARMED state lives on the dispatcher, not on the visible buttons. Stream Deck
  // tears down (willDisappear) and rebuilds (willAppear) per-key contexts on every
  // page or profile switch, which would otherwise wipe alerting state. Tracking
  // armed types here lets onWillAppear restore the visual + remaining timeout.
  private armed = new Set<EventType>();
  private armedAt = new Map<EventType, number>();

  constructor(opts: DispatcherOpts) {
    this.opts = opts;
  }

  // Single matrix-driven entry point. Replaces dispatch / dismiss / dismissAll.
  // For each event type, the dispatcher tracks one of three states:
  //   IDLE     — nothing pending, not armed
  //   PENDING  — delay timer running; will fire (audio + flash) on expiry
  //   ARMED    — delay elapsed; alert is active for this type (independent of
  //              whether any button is currently visible to render it)
  // Same-type arm during PENDING is a deliberate no-op (timer keeps running, no
  // extension), so a burst of arming events still produces exactly one alert.
  handleRoute(route: string, sessionId: string, ids?: { taskId?: string; agentId?: string }): void {
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
        const id = this.resolveId(entry.metric, sessionId, ids);
        if (id === undefined) {
          this.opts.log?.warn(`drop missing-id route=${route} metric=${entry.metric}`);
          return;
        }
      }
    }

    this.opts.log?.debug(
      `handleRoute route=${route} session=${sessionId.slice(0, 8)} clears=${spec.clears.join(",") || "-"} arms=${spec.arms ?? "-"} counters=${spec.counters?.map((e) => `${e.metric}.${e.op}`).join(",") ?? "-"}`
    );
    for (const t of spec.clears) this.clearType(t);
    if (spec.arms) this.armType(spec.arms);
    if (spec.counters) this.applyCounters(spec.counters, sessionId, ids);
    this.opts.log?.trace(`state stop=${this.stateOf("stop")} permission=${this.stateOf("permission")} task-completed=${this.stateOf("task-completed")}`);
  }

  // Public seam used by SessionSetCounter (tasks instance) onSessionDrained. Wraps the
  // existing private armType so external callers can fire only the task-completed
  // alert and cannot bypass the matrix for arbitrary types.
  fireTaskCompleted(): void {
    this.armType("task-completed");
  }

  /**
   * Public seam used by the action layer when a user keypress or per-button
   * auto-timeout dismisses an alert. Clears ARMED state for the given event
   * type and dismisses every currently-alerting button of that type.
   *
   * Alert-only scope: does NOT touch the SessionSetCounter instances or the in-flight count
   * visual. Covers all three dispatcher states by delegating to clearType:
   * IDLE (no-op on dispatcher state; still dismisses stray alerting visuals),
   * PENDING (cancels the timer so the alert never fires), ARMED (clears state
   * + visuals). Mirrors the fireTaskCompleted() pattern: a narrow public seam
   * that cannot bypass the route matrix for arbitrary state.
   */
  dismissArmed(type: EventType): void {
    this.opts.log?.debug(`dismissArmed type=${type}`);
    this.clearType(type);
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

  // Public lookup for EventFlashAction.onWillAppear: returns ms since this type was
  // armed, or null if not armed. Lets a freshly-rebuilt button context restore
  // the alert with the correct remaining auto-timeout.
  armedMsAgo(type: EventType): number | null {
    const at = this.armedAt.get(type);
    if (at === undefined) return null;
    return Date.now() - at;
  }

  private stateOf(type: EventType): "IDLE" | "PENDING" | "ARMED" {
    if (this.pending.has(type)) return "PENDING";
    if (this.armed.has(type)) return "ARMED";
    return "IDLE";
  }

  private clearType(type: EventType): void {
    const timer = this.pending.get(type);
    if (timer) {
      clearTimeout(timer);
      this.pending.delete(type);
    }
    this.armed.delete(type);
    this.armedAt.delete(type);
    for (const [, btn] of this.opts.getButtons()) {
      if (btn.state.alerting && btn.eventType === type) btn.dismiss();
    }
  }

  private armType(type: EventType): void {
    if (this.pending.has(type)) {
      this.opts.log?.debug(`arm skip: type=${type} already PENDING`);
      return;
    }
    if (this.armed.has(type)) {
      this.fire(type);
      return;
    }
    const delayMs = this.opts.getGlobalSettings().alertDelay[type];
    if (delayMs <= 0) {
      this.fire(type);
      return;
    }
    const timer = setTimeout(() => {
      this.pending.delete(type);
      this.fire(type);
    }, delayMs);
    this.pending.set(type, timer);
    this.opts.log?.info(`pending type=${type} delayMs=${delayMs}`);
  }

  private fire(type: EventType): void {
    const buttons = this.opts.getButtons();
    let dismissed = 0;
    let armed = 0;
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
    this.armed.add(type);
    this.armedAt.set(type, Date.now());
    const audioCfg = this.opts.getGlobalSettings().audio[type];
    const path = audioCfg.soundPath ?? defaultSoundPath(type);
    this.opts.log?.info(`fire type=${type} buttons=${buttons.size} dismissed=${dismissed} armed=${armed} audio=${path ? "yes" : "no"}`);
    if (!path) return;
    this.opts.audioPlayer.play(path);
  }
}
