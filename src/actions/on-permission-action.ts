import { action, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { EventType } from "../types.js";
import { formatAlertTitle } from "../alert-title.js";
import { EventFlashAction } from "./event-flash-action.js";

@action({ UUID: "com.nshopik.agentichooks.permission" })
export class OnPermissionAction extends EventFlashAction {
  protected readonly eventType: EventType = "permission";

  /**
   * Called by plugin.ts via onArmedChanged when the armed-session context for
   * the permission type changes. Applies the cwd title to all visible On Permission
   * key contexts. Follows the OnStopAction.broadcastAlertTitle precedent.
   */
  broadcastAlertTitle(): void {
    const ctx = this.opts.armedContext?.(this.eventType) ?? null;
    const title = ctx !== null ? formatAlertTitle(ctx.count, ctx.latestCwd) : undefined;
    for (const [, c] of this.contexts) {
      void c.setTitle(title);
    }
  }

  /**
   * Restores title after a Stream Deck page/profile switch.
   * Applies the cwd title only when the base re-alerted this button.
   * Follows the OnStopAction.onWillAppear title-restore pattern.
   */
  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    await super.onWillAppear(ev);
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    if (ctx.state.alerting) {
      const armedCtx = this.opts.armedContext?.(this.eventType) ?? null;
      if (armedCtx !== null) {
        void ctx.setTitle(formatAlertTitle(armedCtx.count, armedCtx.latestCwd));
      }
    }
  }
}
