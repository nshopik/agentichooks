import {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type SendToPluginEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";
import { DEFAULT_FLASH_SETTINGS, type FlashSettings, type ButtonState } from "../types.js";
import type { DispatchableButton } from "../dispatcher.js";
import { keyIconBase64, readImageAsDataUri } from "../icons.js";

type Ctx = {
  context: string;
  settings: FlashSettings;
  state: ButtonState;
  setImage: (b64: string) => Promise<void>;
};

type RawSettings = JsonObject & {
  eventType?: FlashSettings["eventType"];
  flashMode?: FlashSettings["flashMode"];
  pulseIntervalMs?: number;
  autoTimeoutMs?: number;
  autoTimeoutSeconds?: number | string;
  idleIconPath?: string;
  alertIconPath?: string;
};

function mergeSettings(raw: JsonObject | undefined): FlashSettings {
  const r = (raw ?? {}) as RawSettings;
  let timeoutMs = DEFAULT_FLASH_SETTINGS.autoTimeoutMs;
  if (r.autoTimeoutSeconds !== undefined) {
    const seconds = Number(r.autoTimeoutSeconds);
    if (!Number.isNaN(seconds)) timeoutMs = seconds * 1000;
  } else if (typeof r.autoTimeoutMs === "number") {
    timeoutMs = r.autoTimeoutMs;
  }
  return {
    eventType: r.eventType ?? DEFAULT_FLASH_SETTINGS.eventType,
    flashMode: r.flashMode ?? DEFAULT_FLASH_SETTINGS.flashMode,
    pulseIntervalMs: typeof r.pulseIntervalMs === "number" ? r.pulseIntervalMs : DEFAULT_FLASH_SETTINGS.pulseIntervalMs,
    autoTimeoutMs: timeoutMs,
    idleIconPath: r.idleIconPath || undefined,
    alertIconPath: r.alertIconPath || undefined,
  };
}

@action({ UUID: "com.nshopik.claudenotify.flash" })
export class FlashAction extends SingletonAction<JsonObject> {
  private readonly contexts = new Map<string, Ctx>();

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
    const ctx: Ctx = {
      context: ev.action.id,
      settings,
      state: { alerting: false, pulseFrame: 0 },
      setImage: (b64) => ev.action.setImage(b64) as Promise<void>,
    };
    this.contexts.set(ev.action.id, ctx);
    await ctx.setImage(this.idleIcon(ctx));
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
    ctx.settings = mergeSettings(ev.payload.settings);
    if (!ctx.state.alerting) await ctx.setImage(this.idleIcon(ctx));
  }

  override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    const payload = ev.payload as { kind?: string } | null;
    if (payload?.kind === "test-flash") {
      this.alertContext(ctx);
    }
  }

  private alertContext(ctx: Ctx): void {
    this.clearTimers(ctx);
    ctx.state.alerting = true;
    ctx.state.pulseFrame = 1;
    void ctx.setImage(this.alertIcon(ctx));
    if (ctx.settings.flashMode === "pulse") {
      const interval = Math.max(100, ctx.settings.pulseIntervalMs);
      ctx.state.pulseTimer = setInterval(() => {
        ctx.state.pulseFrame = ctx.state.pulseFrame === 1 ? 0 : 1;
        void ctx.setImage(ctx.state.pulseFrame === 1 ? this.alertIcon(ctx) : this.idleIcon(ctx));
      }, interval);
    }
    if (ctx.settings.autoTimeoutMs > 0) {
      ctx.state.timeoutTimer = setTimeout(() => this.dismissContext(ctx), ctx.settings.autoTimeoutMs);
    }
  }

  private dismissContext(ctx: Ctx): void {
    this.clearTimers(ctx);
    ctx.state.alerting = false;
    ctx.state.pulseFrame = 0;
    void ctx.setImage(this.idleIcon(ctx));
  }

  private clearTimers(ctx: Ctx): void {
    if (ctx.state.pulseTimer) { clearInterval(ctx.state.pulseTimer); ctx.state.pulseTimer = undefined; }
    if (ctx.state.timeoutTimer) { clearTimeout(ctx.state.timeoutTimer); ctx.state.timeoutTimer = undefined; }
  }

  private idleIcon(ctx: Ctx): string {
    if (ctx.settings.idleIconPath) {
      try { return readImageAsDataUri(ctx.settings.idleIconPath); } catch { /* fall through */ }
    }
    try {
      return keyIconBase64(ctx.settings.eventType, "idle");
    } catch {
      return "";
    }
  }

  private alertIcon(ctx: Ctx): string {
    if (ctx.settings.alertIconPath) {
      try { return readImageAsDataUri(ctx.settings.alertIconPath); } catch { /* fall through */ }
    }
    try {
      return keyIconBase64(ctx.settings.eventType, "alert");
    } catch {
      return "";
    }
  }
}
