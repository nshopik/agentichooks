import { action, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { EventType } from "../types.js";
import { renderCountIcon } from "../render-count-icon.js";
import { EventFlashAction } from "./event-flash-action.js";

@action({ UUID: "com.nshopik.agentichooks.task-completed" })
export class OnTaskCompletedAction extends EventFlashAction {
  protected readonly eventType: EventType = "task-completed";

  /**
   * Called by TaskCounter.onCountChanged. Iterates every visible Task
   * Completed key context and pushes the current visual.
   *
   * setImage targets state 0 (idle) explicitly — without the state arg the
   * SDK only overrides the *current* state's image. Targeting 0 means the
   * in-flight image is in place whether or not the button is currently
   * alerting (covers the rare task-created-mid-alert race: a fresh task
   * arrives while the prior alert is still on screen; the in-flight image
   * is queued under state 0 and takes effect on the next dismiss).
   */
  broadcastCount(count: number): void {
    for (const [, ctx] of this.contexts) {
      if (count > 0) {
        void ctx.setImage(renderCountIcon(count), 0);
      } else {
        void ctx.setImage("", 0);
      }
    }
  }

  /**
   * Stream Deck rebuilds per-key contexts on every page/profile switch.
   * The base class restores alerting state from Dispatcher.armedMsAgo;
   * here we additionally restore the in-flight visual from TaskCounter.
   * Order matters: super first (which may set alerting from armedMsAgo),
   * then we no-op if alerting (manifest alert image already on screen),
   * else apply the in-flight image when count > 0.
   */
  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    await super.onWillAppear(ev);
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    if (ctx.state.alerting) return;
    const count = this.opts.currentCount?.() ?? 0;
    if (count > 0) {
      void ctx.setImage(renderCountIcon(count), 0);
    }
  }
}
