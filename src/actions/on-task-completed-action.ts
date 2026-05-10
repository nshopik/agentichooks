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
  private static readonly FRAMES = ["·", "*", "✶", "✢", "✻", "✢", "✶", "*"];

  private frameIdx = 0;
  private animInterval: ReturnType<typeof setInterval> | null = null;

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
      const frame = ctx.settings.animateCounter !== false ? OnTaskCompletedAction.FRAMES[this.frameIdx] : undefined;
      void ctx.setImage(renderCountIcon(count, frame), 0);
    }
  }
}
