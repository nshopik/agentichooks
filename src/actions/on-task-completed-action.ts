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
   * Renders whenever there is anything to show — taskSum > 0 OR agentSum > 0. A lone
   * subagent (taskSum = 0, agentSum > 0) still paints: center shows a big "0", pill
   * shows the subagent count. Only the fully-idle case (both 0) clears the state-0
   * image override so subsequent renders fall back to the manifest-defined idle image
   * (preserving any user customisation applied via the State Picker). The setImage
   * targets state 0 explicitly — without the state arg the SDK only overrides the
   * *current* state's image. Targeting 0 means the in-flight image is in place whether
   * or not the button is currently alerting (covers the rare task-created-mid-alert race).
   */
  broadcastCounts(taskSum: number, agentSum: number): void {
    if (taskSum > 0 || agentSum > 0) {
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
   * 2. taskSum === 0 AND agentSum === 0 → clear the state-0 image override.
   *    broadcastCounts(0, 0) clears only contexts visible at the time of the
   *    →0 transition; a button hidden during that window reappears with Stream
   *    Deck's remembered override. Clearing here falls back to the manifest/user
   *    idle image.
   * 3. Alerting (something to show) → no-op. Badge is already queued under state 0.
   * 4. Not alerting, taskSum > 0 OR agentSum > 0 → repaint the current in-flight badge.
   */
  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    await super.onWillAppear(ev);
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    const taskSum = this.opts.currentCount?.() ?? 0;
    // currentAgentCount is wired in plugin.ts so the pill is correct immediately
    // on restore, not just after the next broadcastCounts call. A 0-restore would
    // be the same stale-visual bug class that currentCount fixed for the task number.
    const agentSum = this.opts.currentAgentCount?.() ?? 0;
    if (taskSum === 0 && agentSum === 0) {
      void ctx.setImage("", 0);
      return;
    }
    if (ctx.state.alerting) return;
    // Restore both numbers on page switch — painting both is required (a lone
    // subagent with taskSum = 0 paints a "0" center plus the pill).
    void ctx.setImage(renderCountIcon(taskSum, agentSum), 0);
  }
}
