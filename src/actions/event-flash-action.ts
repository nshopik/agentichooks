import streamDeck, {
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import {
  DEFAULT_AUTO_TIMEOUT_BY_EVENT,
  DEFAULT_FLASH_SETTINGS,
  normalizeFlashMode,
  type EventType,
  type FlashSettings,
  type ButtonState,
} from "../types.js";
import type { DispatchableButton } from "../dispatcher.js";

const STATE_IDLE = 0;
const STATE_ALERT = 1;

export type EventFlashActionOpts = {
  /**
   * Returns `true` when audio actually started, `false` when the resolved
   * sound path was empty or the file does not exist. The PI's "Test sound"
   * button uses the `false` result to surface `showAlert()`.
   */
  onTestSound?: (eventType: EventType) => boolean;
  /**
   * Lazy lookup against the Dispatcher so onWillAppear can restore alerting
   * state after a Stream Deck page/profile switch. Returns ms since the type
   * was armed, or null if not currently armed.
   */
  armedMsAgo?: (eventType: EventType) => number | null;
  /**
   * Lazy lookup so OnStopAction.onWillAppear can restore the thinking visual
   * after a page/profile switch. Returns true when the thinking sum > 0.
   * Only consumed by OnStopAction. Mirrors the currentCount precedent.
   */
  currentThinking?: () => boolean;
  /**
   * Lazy lookup against TaskCounter so OnTaskCompletedAction.onWillAppear can
   * restore the in-flight visual after a page/profile switch. Returns the
   * current global subagent count. Only consumed by OnTaskCompletedAction.
   */
  currentCount?: () => number;
  /**
   * Lazy lookup so OnTaskCompletedAction.onWillAppear can restore the coral pill
   * after a page/profile switch while subagents are still running. Returns the
   * current subagent sum. Restoring it as 0 would be the same stale-visual bug
   * class that currentCount fixed for the task number — both numbers must be
   * painted correctly on restore. Only consumed by OnTaskCompletedAction.
   */
  currentAgentCount?: () => number;
  /**
   * Lazy callback wired to Dispatcher.dismissArmed. Called when this button
   * type's alert is dismissed by a user keypress or per-button auto-timeout.
   * The dispatcher then clears ARMED state and dismisses every alerting button
   * of this type (type-wide semantics). When absent, falls back to the local
   * dismissContext — pre-fix behavior, dispatcher ARMED is not cleared. Must
   * never run unwired in production (plugin.ts always wires this). Mirrors the
   * armedMsAgo lazy-arrow pattern.
   */
  onDismissed?: (eventType: EventType) => void;
};

type Ctx = {
  context: string;
  settings: FlashSettings;
  state: ButtonState;
  setState: (s: 0 | 1) => Promise<void>;
  // Optional state targeting — pass 0 to override the idle-state image,
  // 1 to override the alert-state image, undefined for the current state.
  // Used by OnTaskCompletedAction for the in-flight count visual; the base
  // class never calls it.
  setImage: (image: string, state?: 0 | 1) => Promise<void>;
};

type RawSettings = JsonObject & {
  flashMode?: FlashSettings["flashMode"];
  pulseIntervalMs?: number;
  autoTimeoutMs?: number;
  autoTimeoutSeconds?: number | string;
  animateThinking?: boolean;
};

export abstract class EventFlashAction extends SingletonAction<JsonObject> {
  protected abstract readonly eventType: EventType;
  protected readonly contexts = new Map<string, Ctx>();
  protected readonly opts: EventFlashActionOpts;

  constructor(opts: EventFlashActionOpts = {}) {
    super();
    this.opts = opts;
  }

  buttonsForDispatcher(): Map<string, DispatchableButton> {
    const out = new Map<string, DispatchableButton>();
    for (const [k, v] of this.contexts) {
      out.set(k, {
        eventType: this.eventType,
        settings: v.settings,
        state: v.state,
        alert: () => this.alertContext(v),
        dismiss: () => this.dismissContext(v),
      });
    }
    return out;
  }

  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    const settings = this.mergeSettings(ev.payload.settings);
    const action = ev.action;
    const isKey = action.isKey();
    const ctx: Ctx = {
      context: action.id,
      settings,
      state: { alerting: false, pulseFrame: 0 },
      setState: isKey ? (s) => (action as KeyAction<JsonObject>).setState(s) : async () => {},
      // state !== undefined (NOT `state ?`) — the truthy check would map state===0 to undefined,
      // losing our explicit idle-state targeting. Pass { state } only when caller specified one.
      setImage: isKey ? (img, state) => (action as KeyAction<JsonObject>).setImage(img, state !== undefined ? { state } : undefined) : async () => {},
    };
    this.contexts.set(action.id, ctx);
    // Stream Deck rebuilds per-key contexts on every page or profile switch.
    // If the dispatcher still considers this event type armed, resume the
    // alert with the auto-timeout's remaining budget.
    const msAgo = this.opts.armedMsAgo?.(this.eventType) ?? null;
    if (msAgo === null) {
      await ctx.setState(STATE_IDLE);
      return;
    }
    if (settings.autoTimeoutMs > 0) {
      const remaining = settings.autoTimeoutMs - msAgo;
      if (remaining <= 0) {
        await ctx.setState(STATE_IDLE);
        return;
      }
      this.alertContext(ctx, remaining);
      return;
    }
    this.alertContext(ctx);
  }

  override async onWillDisappear(ev: WillDisappearEvent<JsonObject>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (ctx) this.clearTimers(ctx);
    this.contexts.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<JsonObject>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    if (ctx.state.alerting) {
      // Do NOT call dismissContext(ctx) here before onDismissed. The originating
      // button's ctx.state.alerting must remain true so that the dispatcher's
      // clearType includes it in the round-trip dismissal. Calling dismissContext
      // first would flip alerting=false and produce a redundant double-clear path.
      if (this.opts.onDismissed) this.opts.onDismissed(this.eventType);
      else this.dismissContext(ctx); // unwired fallback (tests, safety — pre-fix behavior)
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<JsonObject>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    ctx.settings = this.mergeSettings(ev.payload.settings);
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) {
      streamDeck.logger.info(`onSendToPlugin: no ctx for ${ev.action.id}`);
      return;
    }
    const payload = ev.payload as { kind?: string; event?: EventType } | null;
    streamDeck.logger.info(`onSendToPlugin: kind=${payload?.kind} event=${payload?.event ?? this.eventType}`);
    if (payload?.kind === "test-flash") {
      this.alertContext(ctx);
      this.opts.onTestSound?.(this.eventType);
      return;
    }
    if (payload?.kind === "test-audio" && payload.event) {
      const ok = this.opts.onTestSound?.(payload.event);
      if (ok === false) {
        streamDeck.logger.warn(
          `test-audio failed: event=${payload.event} (showing key alert)`,
        );
        await ev.action.showAlert();
      }
    }
  }

  private mergeSettings(raw: JsonObject | undefined): FlashSettings {
    const r = (raw ?? {}) as RawSettings;
    let timeoutMs: number;
    if (r.autoTimeoutSeconds !== undefined) {
      const seconds = Number(r.autoTimeoutSeconds);
      timeoutMs = Number.isNaN(seconds) ? DEFAULT_AUTO_TIMEOUT_BY_EVENT[this.eventType] : seconds * 1000;
    } else if (typeof r.autoTimeoutMs === "number") {
      timeoutMs = r.autoTimeoutMs;
    } else {
      timeoutMs = DEFAULT_AUTO_TIMEOUT_BY_EVENT[this.eventType];
    }
    return {
      flashMode: normalizeFlashMode(r.flashMode),
      pulseIntervalMs: typeof r.pulseIntervalMs === "number" ? r.pulseIntervalMs : DEFAULT_FLASH_SETTINGS.pulseIntervalMs,
      autoTimeoutMs: timeoutMs,
      animateThinking: r.animateThinking,
    };
  }

  private alertContext(ctx: Ctx, timeoutOverrideMs?: number): void {
    this.clearTimers(ctx);
    ctx.state.alerting = true;
    ctx.state.pulseFrame = 1;
    void ctx.setState(STATE_ALERT);
    if (ctx.settings.flashMode === "pulse") {
      const interval = Math.max(100, ctx.settings.pulseIntervalMs);
      ctx.state.pulseTimer = setInterval(() => {
        ctx.state.pulseFrame = ctx.state.pulseFrame === 1 ? 0 : 1;
        void ctx.setState(ctx.state.pulseFrame === 1 ? STATE_ALERT : STATE_IDLE);
      }, interval);
    }
    const timeoutMs = timeoutOverrideMs ?? ctx.settings.autoTimeoutMs;
    if (timeoutMs > 0) {
      ctx.state.timeoutTimer = setTimeout(() => {
        // Do NOT call dismissContext(ctx) here before onDismissed. The originating
        // button's ctx.state.alerting must remain true so that the dispatcher's
        // clearType includes it in the round-trip dismissal. Calling dismissContext
        // first would flip alerting=false and produce a redundant double-clear path.
        // Note: the round-trip will re-run clearTimers(ctx) against the already-fired
        // timeoutTimer — clearTimeout on a fired handle is a harmless no-op.
        if (this.opts.onDismissed) this.opts.onDismissed(this.eventType);
        else this.dismissContext(ctx); // unwired fallback (tests, safety — pre-fix behavior)
      }, timeoutMs);
    }
  }

  private dismissContext(ctx: Ctx): void {
    this.clearTimers(ctx);
    ctx.state.alerting = false;
    ctx.state.pulseFrame = 0;
    void ctx.setState(STATE_IDLE);
  }

  private clearTimers(ctx: Ctx): void {
    if (ctx.state.pulseTimer) { clearInterval(ctx.state.pulseTimer); ctx.state.pulseTimer = undefined; }
    if (ctx.state.timeoutTimer) { clearTimeout(ctx.state.timeoutTimer); ctx.state.timeoutTimer = undefined; }
  }
}
