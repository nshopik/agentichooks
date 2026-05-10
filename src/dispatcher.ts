import type { EventType, GlobalSettings, FlashSettings, ButtonState, Logger } from "./types.js";
import { defaultSoundPath } from "./system-sounds.js";

export type DispatchableButton = {
  eventType: EventType;
  settings: FlashSettings;
  state: ButtonState;
  alert: () => void;
  dismiss: () => void;
};

// Minimal interface — the dispatcher only mutates the counter; reads happen
// via the counter's own callbacks wired into the action layer.
export type DispatcherTaskCounter = {
  increment(): void;
  decrement(): void;
  reset(): void;
};

export type DispatcherOpts = {
  audioPlayer: { play: (path: string) => void };
  getGlobalSettings: () => GlobalSettings;
  getButtons: () => Map<string, DispatchableButton>;
  log?: Logger;
  taskCounter?: DispatcherTaskCounter;
};

// Each incoming HTTP route maps to a set of event types whose alerts it clears
// and (optionally) the event type it arms. Apply order is clears-first then arm,
// so a fresh stop cancels stale permission/task-completed before entering its
// own pending window.
type CounterDirective = "increment" | "decrement" | "reset";
type RouteSpec = {
  clears: ReadonlyArray<EventType>;
  arms?: EventType;
  // Counter directive applied AFTER clears/arms. No-op if no taskCounter
  // is wired into the Dispatcher (kept optional so unit tests targeting
  // unrelated routes don't need a stub).
  counter?: CounterDirective;
};

const ROUTES: Readonly<Record<string, RouteSpec>> = {
  "/event/stop":                  { arms: "stop",           clears: ["permission", "task-completed"] },
  "/event/stop-failure":          { arms: "stop",           clears: ["permission", "task-completed"] },
  "/event/permission-request":    { arms: "permission",     clears: [] },
  // Clears task-completed so a fresh task arriving during the post-zero alert (or its 1s
  // pre-fire delay) dismisses the alert immediately and lets the in-flight count visual
  // take over — without this, the count "1" only appears after the 30s auto-timeout.
  "/event/task-created":          {                         clears: ["task-completed"], counter: "increment" },
  // arms: "task-completed" REMOVED — arming is now indirect, driven by
  // TaskCounter.onZeroReached → dispatcher.fireTaskCompleted().
  "/event/task-completed":        {                         clears: ["permission"], counter: "decrement" },
  "/event/session-start":         {                         clears: ["stop", "permission", "task-completed"], counter: "reset" },
  "/event/session-end":           {                         clears: ["stop", "permission", "task-completed"], counter: "reset" },
  "/event/user-prompt-submit":    {                         clears: ["stop", "permission", "task-completed"] },
  "/event/permission-denied":     {                         clears: ["permission"] },
  "/event/post-tool-use":         {                         clears: ["permission"] },
  "/event/post-tool-use-failure": {                         clears: ["permission"] },
  // The agentic loop can restart after Stop without a UserPromptSubmit (auto-continue,
  // /continue, compact-and-continue). A fresh PreToolUse means the agent is working
  // again, so a still-armed stop alert is stale.
  "/event/pre-tool-use":          {                         clears: ["stop"] },
};

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
  handleRoute(route: string): void {
    const spec = ROUTES[route];
    if (!spec) {
      this.opts.log?.debug(`unknown route=${route}`);
      return; // no state change; skip trace dump
    }
    this.opts.log?.debug(`handleRoute route=${route} clears=${spec.clears.join(",") || "-"} arms=${spec.arms ?? "-"} counter=${spec.counter ?? "-"}`);
    for (const t of spec.clears) this.clearType(t);
    if (spec.arms) this.armType(spec.arms);
    if (spec.counter) this.applyCounter(spec.counter);
    this.opts.log?.trace(`state stop=${this.stateOf("stop")} permission=${this.stateOf("permission")} task-completed=${this.stateOf("task-completed")}`);
  }

  // Public seam used by TaskCounter.onZeroReached. Wraps the existing
  // private armType so external callers can fire only the task-completed
  // alert and cannot bypass the matrix for arbitrary types.
  fireTaskCompleted(): void {
    this.armType("task-completed");
  }

  private applyCounter(directive: CounterDirective): void {
    const c = this.opts.taskCounter;
    if (!c) return;
    if (directive === "increment") c.increment();
    else if (directive === "decrement") c.decrement();
    else if (directive === "reset") c.reset();
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
