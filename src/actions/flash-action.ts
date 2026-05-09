import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import { ALL_EVENT_TYPES, DEFAULT_AUTO_TIMEOUT_BY_EVENT, DEFAULT_FLASH_SETTINGS, type EventType, type FlashSettings, type ButtonState } from "../types.js";
import type { DispatchableButton } from "../dispatcher.js";

const STATE_IDLE = 0;
const STATE_ALERT = 1;

export type FlashActionOpts = {
  /**
   * Returns `true` when audio actually started, `false` when the resolved
   * sound path was empty or the file does not exist. The caller (the test-audio
   * PI button) uses the `false` result to surface `showAlert()` so the user
   * knows the press failed instead of seeing nothing.
   */
  onTestSound?: (eventType: EventType) => boolean;
  /**
   * Lazy lookup against the Dispatcher so onWillAppear can restore alerting state
   * after a Stream Deck page/profile switch. Returns ms since the type was armed,
   * or null if not currently armed.
   */
  armedMsAgo?: (eventType: EventType) => number | null;
};

type Ctx = {
  context: string;
  settings: FlashSettings;
  state: ButtonState;
  setState: (s: 0 | 1) => Promise<void>;
  setImage: (image: string, state: 0 | 1) => Promise<void>;
};

type RawSettings = JsonObject & {
  eventType?: FlashSettings["eventType"];
  flashMode?: FlashSettings["flashMode"];
  pulseIntervalMs?: number;
  autoTimeoutMs?: number;
  autoTimeoutSeconds?: number | string;
};

function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (ALL_EVENT_TYPES as ReadonlyArray<string>).includes(value);
}

function mergeSettings(raw: JsonObject | undefined): FlashSettings {
  const r = (raw ?? {}) as RawSettings;
  // Guard against stale persisted eventType values (e.g. "idle" from pre-v6 profiles).
  // Without this, a button with an unknown eventType becomes a permanently-silent
  // ghost: the dispatcher never matches it, and setImage builds a missing path.
  let eventType: EventType;
  if (r.eventType === undefined) {
    eventType = DEFAULT_FLASH_SETTINGS.eventType;
  } else if (isEventType(r.eventType)) {
    eventType = r.eventType;
  } else {
    streamDeck.logger.warn(`flash-action: unknown eventType ${JSON.stringify(r.eventType)}, falling back to ${DEFAULT_FLASH_SETTINGS.eventType}`);
    eventType = DEFAULT_FLASH_SETTINGS.eventType;
  }
  let timeoutMs: number;
  if (r.autoTimeoutSeconds !== undefined) {
    const seconds = Number(r.autoTimeoutSeconds);
    timeoutMs = Number.isNaN(seconds) ? DEFAULT_AUTO_TIMEOUT_BY_EVENT[eventType] : seconds * 1000;
  } else if (typeof r.autoTimeoutMs === "number") {
    timeoutMs = r.autoTimeoutMs;
  } else {
    timeoutMs = DEFAULT_AUTO_TIMEOUT_BY_EVENT[eventType];
  }
  return {
    eventType,
    flashMode: r.flashMode ?? DEFAULT_FLASH_SETTINGS.flashMode,
    pulseIntervalMs: typeof r.pulseIntervalMs === "number" ? r.pulseIntervalMs : DEFAULT_FLASH_SETTINGS.pulseIntervalMs,
    autoTimeoutMs: timeoutMs,
  };
}

function defaultImageForState(event: EventType, state: 0 | 1): string {
  return `images/keys/${event}-${state === STATE_IDLE ? "idle" : "alert"}.png`;
}

@action({ UUID: "com.nshopik.agentichooks.flash" })
export class FlashAction extends SingletonAction<JsonObject> {
  private readonly contexts = new Map<string, Ctx>();
  private readonly opts: FlashActionOpts;

  constructor(opts: FlashActionOpts = {}) {
    super();
    this.opts = opts;
  }

  buttonsForDispatcher(): Map<string, DispatchableButton> {
    const out = new Map<string, DispatchableButton>();
    for (const [k, v] of this.contexts) {
      out.set(k, {
        settings: v.settings,
        state: v.state,
        alert: () => this.alertContext(v),
        dismiss: () => this.dismissContext(v),
      });
    }
    return out;
  }

  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    const settings = mergeSettings(ev.payload.settings);
    const action = ev.action;
    const isKey = action.isKey();
    const ctx: Ctx = {
      context: action.id,
      settings,
      state: { alerting: false, pulseFrame: 0 },
      setState: isKey ? (s) => (action as KeyAction<JsonObject>).setState(s) : async () => {},
      setImage: isKey
        ? (image, state) => (action as KeyAction<JsonObject>).setImage(image, { state })
        : async () => {},
    };
    this.contexts.set(action.id, ctx);
    await this.applyEventTypeDefaults(ctx);
    // Stream Deck rebuilds per-key contexts on every page or profile switch.
    // If the dispatcher still considers this event type armed, resume the alert
    // with the auto-timeout's remaining budget instead of resetting to idle.
    const msAgo = this.opts.armedMsAgo?.(settings.eventType) ?? null;
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
    if (ctx.state.alerting) this.dismissContext(ctx);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<JsonObject>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    const prev = ctx.settings;
    ctx.settings = mergeSettings(ev.payload.settings);
    if (ctx.settings.eventType !== prev.eventType) {
      await this.applyEventTypeDefaults(ctx);
    }
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) {
      streamDeck.logger.info(`onSendToPlugin: no ctx for ${ev.action.id}`);
      return;
    }
    const payload = ev.payload as { kind?: string; event?: EventType } | null;
    streamDeck.logger.info(`onSendToPlugin: kind=${payload?.kind} event=${payload?.event ?? ctx.settings.eventType}`);
    if (payload?.kind === "test-flash") {
      this.alertContext(ctx);
      this.opts.onTestSound?.(ctx.settings.eventType);
      return;
    }
    if (payload?.kind === "test-audio" && payload.event) {
      const ok = this.opts.onTestSound?.(payload.event);
      if (ok === false) await ev.action.showAlert();
    }
  }

  private async applyEventTypeDefaults(ctx: Ctx): Promise<void> {
    // setImage per state seeds the manifest defaults to match the chosen event type.
    // The SDK silently no-ops when the user has set a custom image via the State Picker,
    // so user customizations always win over these defaults.
    await ctx.setImage(defaultImageForState(ctx.settings.eventType, STATE_IDLE), STATE_IDLE);
    await ctx.setImage(defaultImageForState(ctx.settings.eventType, STATE_ALERT), STATE_ALERT);
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
      ctx.state.timeoutTimer = setTimeout(() => this.dismissContext(ctx), timeoutMs);
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
