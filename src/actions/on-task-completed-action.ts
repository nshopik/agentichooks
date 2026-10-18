import { action, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { EventType } from "../types.js";
import { renderTaskKeyIcon } from "../render-count-icon.js";
import { EventFlashAction } from "./event-flash-action.js";

@action({ UUID: "com.nshopik.agentichooks.task-completed" })
export class OnTaskCompletedAction extends EventFlashAction {
  protected readonly eventType: EventType = "task-completed";

  private icon(taskSum: number, agentSum: number): string {
    return renderTaskKeyIcon(taskSum, agentSum, this.opts.showTaskCount?.() ?? false);
  }

  /**
   * Called by the plugin's counter wiring when either task or subagent count
   * changes, and on a globals change (showTaskCount toggle).
   *
   * An empty icon (idle) clears the state-0 image override so subsequent renders
   * fall back to the manifest-defined idle image (preserving any user customisation
   * applied via the State Picker). The setImage targets state 0 explicitly — without
   * the state arg the SDK only overrides the *current* state's image. Targeting 0
   * means the in-flight image is in place whether or not the button is currently
   * alerting (covers the rare task-created-mid-alert race).
   */
  broadcastCounts(taskSum: number, agentSum: number): void {
    const image = this.icon(taskSum, agentSum);
    for (const [, ctx] of this.contexts) {
      void ctx.setImage(image, 0);
    }
  }

  /**
   * Stream Deck rebuilds per-key contexts on every page/profile switch, and a
   * key hidden during a broadcastCounts call reappears with Stream Deck's
   * remembered state-0 override. Repaint state 0 unconditionally after super
   * restores alerting state — alerting keys included, since state 0 is what
   * shows after dismissal and on every pulse frame.
   */
  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    await super.onWillAppear(ev);
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    void ctx.setImage(this.icon(this.opts.currentCount?.() ?? 0, this.opts.currentAgentCount?.() ?? 0), 0);
  }
}
