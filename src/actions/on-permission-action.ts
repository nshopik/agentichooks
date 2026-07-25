import { action, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { EventType } from "../types.js";
import { EventFlashAction } from "./event-flash-action.js";

@action({ UUID: "com.nshopik.agentichooks.permission" })
export class OnPermissionAction extends EventFlashAction {
  protected readonly eventType: EventType = "permission";

  /**
   * Restores title after a Stream Deck page/profile switch.
   * Applies the cwd title only when the base re-alerted this button.
   */
  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    await super.onWillAppear(ev);
    const ctx = this.contexts.get(ev.action.id);
    if (ctx) this.restoreAlertTitle(ctx);
  }
}
