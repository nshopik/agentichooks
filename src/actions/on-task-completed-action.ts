import { action, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { EventType } from "../types.js";
import { renderCountIcon } from "../render-count-icon.js";
import { EventFlashAction } from "./event-flash-action.js";

@action({ UUID: "com.nshopik.agentichooks.task-completed" })
export class OnTaskCompletedAction extends EventFlashAction {
  protected readonly eventType: EventType = "task-completed";

  /**
   * Called by the plugin's counter wiring when either task or subagent count changes.
   * Drives both the task-count number and the subagent-count pill.
   *
   * taskSum=0 path clears the state-0 image override so subsequent renders fall back to
   * the manifest-defined idle image (preserving any user customisation applied via the
   * State Picker). The setImage targets state 0 explicitly — without the state arg the
   * SDK only overrides the *current* state's image. Targeting 0 means the in-flight
   * image is in place whether or not the button is currently alerting (covers the rare
   * task-created-mid-alert race).
   */
  broadcastCounts(taskSum: number, agentSum: number): void {
    if (taskSum > 0) {
      for (const [, ctx] of this.contexts) {
        void ctx.setImage(renderCountIcon(taskSum, agentSum), 0);
      }
    } else {
      for (const [, ctx] of this.contexts) {
        void ctx.setImage("", 0);
      }
    }
  }

  /**
   * Stream Deck rebuilds per-key contexts on every page/profile switch.
   * The base class restores alerting state from Dispatcher.armedMsAgo;
   * here we additionally restore — or clear — the in-flight visual.
   * Three-way logic, in order:
   *
   * 1. super first (may set alerting from armedMsAgo).
   * 2. taskSum === 0 → clear the state-0 image override. broadcastCounts(0, …)
   *    clears only contexts visible at the time of the >0 → 0 transition; a button
   *    hidden during that window reappears with Stream Deck's remembered override.
   *    Clearing here falls back to the manifest/user idle image.
   * 3. Alerting (taskSum > 0) → no-op. Badge is already queued under state 0.
   * 4. taskSum > 0, not alerting → repaint the current in-flight badge.
   */
  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    await super.onWillAppear(ev);
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    const taskSum = this.opts.currentCount?.() ?? 0;
    if (taskSum === 0) {
      void ctx.setImage("", 0);
      return;
    }
    if (ctx.state.alerting) return;
    // Restore both numbers on page switch — painting both is required.
    // currentAgentCount is wired in plugin.ts so the pill is correct immediately
    // on restore, not just after the next broadcastCounts call. A 0-restore would
    // be the same stale-visual bug class that currentCount fixed for the task number.
    const agentSum = this.opts.currentAgentCount?.() ?? 0;
    void ctx.setImage(renderCountIcon(taskSum, agentSum), 0);
  }
}
