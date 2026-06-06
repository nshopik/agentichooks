import { action, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { EventType } from "../types.js";
import { renderCountIcon } from "../render-count-icon.js";
import { EventFlashAction } from "./event-flash-action.js";

@action({ UUID: "com.nshopik.agentichooks.task-completed" })
export class OnTaskCompletedAction extends EventFlashAction {
  protected readonly eventType: EventType = "task-completed";

  // Corner-glyph animation frames. 8 frames at 200 ms each = 1.6 s loop;
  // 5 fps stays well inside Stream Deck's 10 fps key-update budget. The
  // sequence is a hand-tuned ease in/out so the glyph "pulses" rather than
  // ticking through unrelated shapes.
  private static readonly FRAMES = ["·", "*", "✶", "✢", "✻", "✢", "✶", "*"] as const;

  private frameIdx = 0;
  private animInterval: NodeJS.Timeout | null = null;

  private startAnimation(): void {
    if (this.animInterval !== null) return;
    this.animInterval = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % OnTaskCompletedAction.FRAMES.length;
      const count = this.opts.currentCount?.() ?? 0;
      if (count > 0) this.renderFrame(count);
    }, 200);
  }

  private stopAnimation(): void {
    if (this.animInterval !== null) {
      clearInterval(this.animInterval);
      this.animInterval = null;
    }
    this.frameIdx = 0;
  }

  /**
   * Re-render every visible Task Completed key context with the current
   * count and frame. When animation is disabled, `frame` is undefined so
   * renderCountIcon paints the static yellow sparkle.
   */
  private renderFrame(count: number): void {
    const frameGlyph = OnTaskCompletedAction.FRAMES[this.frameIdx];
    for (const [, ctx] of this.contexts) {
      const frame = ctx.settings.animateCounter !== false ? frameGlyph : undefined;
      void ctx.setImage(renderCountIcon(count, frame), 0);
    }
  }

  /**
   * Called by TaskCounter.onCountChanged. Drives both the in-flight visual
   * and the corner-glyph animation interval.
   *
   * setImage targets state 0 (idle) explicitly — without the state arg the
   * SDK only overrides the *current* state's image. Targeting 0 means the
   * in-flight image is in place whether or not the button is currently
   * alerting (covers the rare task-created-mid-alert race: a fresh task
   * arrives while the prior alert is still on screen; the in-flight image
   * is queued under state 0 and takes effect on the next dismiss).
   *
   * count=0 path clears the state-0 image override so subsequent renders
   * fall back to the manifest-defined idle image (preserving any user
   * customisation applied via the State Picker).
   */
  broadcastCount(count: number): void {
    if (count > 0) {
      this.startAnimation();
      this.renderFrame(count);
    } else {
      this.stopAnimation();
      for (const [, ctx] of this.contexts) {
        void ctx.setImage("", 0);
      }
    }
  }

  /**
   * Stream Deck rebuilds per-key contexts on every page/profile switch.
   * The base class restores alerting state from Dispatcher.armedMsAgo;
   * here we additionally restore — or clear — the in-flight visual from
   * TaskCounter. Three-way logic, in order:
   *
   * 1. super first (may set alerting from armedMsAgo).
   * 2. count === 0 → clear the state-0 image override. broadcastCount(0)
   *    clears only contexts visible at the time of the >0 → 0 transition;
   *    a button hidden during that window reappears with Stream Deck's
   *    remembered override (a frozen count glyph). Clearing here falls back
   *    to the manifest/user idle image — harmless when no override exists.
   *    Runs even while alerting so a later dismiss lands on the idle image,
   *    not a resurrected badge.
   * 3. Alerting (count > 0) → no-op. The badge for count > 0 is queued
   *    under state 0 by broadcastCount; we don't repaint here to avoid
   *    racing the animation interval.
   * 4. count > 0, not alerting → paint the current in-flight badge.
   */
  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    await super.onWillAppear(ev);
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    const count = this.opts.currentCount?.() ?? 0;
    if (count === 0) {
      // Clear any stale in-flight badge. broadcastCount(0) clears the state-0
      // override only for contexts visible at the time; a button hidden during
      // the >0 → 0 transition reappears with Stream Deck's remembered override
      // (a frozen count glyph). Clearing here falls back to the manifest/user
      // idle image — harmless when no override exists. Runs even while
      // alerting so a later dismiss lands on the idle image, not a
      // resurrected badge.
      void ctx.setImage("", 0);
      return;
    }
    if (ctx.state.alerting) return;
    const frame = ctx.settings.animateCounter !== false ? OnTaskCompletedAction.FRAMES[this.frameIdx] : undefined;
    void ctx.setImage(renderCountIcon(count, frame), 0);
  }
}
