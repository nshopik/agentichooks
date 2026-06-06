import { action, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { EventType } from "../types.js";
import { renderThinkingIcon, THINKING_FRAMES } from "../render-thinking-icon.js";
import { formatElapsed } from "../format-elapsed.js";
import { formatAlertTitle } from "../alert-title.js";
import { EventFlashAction } from "./event-flash-action.js";

@action({ UUID: "com.nshopik.agentichooks.stop" })
export class OnStopAction extends EventFlashAction {
  protected readonly eventType: EventType = "stop";

  // 8-frame pulse at 200 ms per frame = 5 fps; within Stream Deck's 10 fps cap.
  // The sequence is the sparkle-motif pulse from the spec.
  private static readonly FRAMES = THINKING_FRAMES;

  private frameIdx = 0;
  // Timer repaint loop: fires every 200 ms while thinking is active.
  // Advances the sparkle frame AND repaints the elapsed timer on every context.
  // Runs even when every context has animateThinking unchecked (timer still ticks).
  private animInterval: NodeJS.Timeout | null = null;

  private startAnimation(): void {
    if (this.animInterval !== null) return;
    this.animInterval = setInterval(() => {
      this.frameIdx = (this.frameIdx + 1) % OnStopAction.FRAMES.length;
      this.renderThinkingFrame();
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
   * Re-render every On Stop key context with the current thinking frame and
   * elapsed timer. All contexts receive a repaint while the repaint loop runs.
   * animateThinking gates only the corner sparkle:
   *   - animateThinking !== false → corner sparkle + centered timer
   *   - animateThinking === false → centered timer only (no sparkle)
   *
   * No alerting guard: timer paints state 0 unconditionally while thinking,
   * exactly like the prior sparkle behavior. The armed alert wins via state-1
   * precedence — skipping paints would diverge from current behavior.
   */
  private renderThinkingFrame(): void {
    // Non-null assertion safe: frameIdx is always kept in-bounds by modulo.
    const frameGlyph = OnStopAction.FRAMES[this.frameIdx]!;
    const elapsedMs = this.opts.currentElapsedMs?.() ?? null;
    const label = elapsedMs !== null ? formatElapsed(elapsedMs) : null;
    for (const [, ctx] of this.contexts) {
      const sparkle = ctx.settings.animateThinking !== false ? frameGlyph : null;
      void ctx.setImage(renderThinkingIcon(sparkle, label), 0);
    }
  }

  /**
   * Called by plugin.ts when the thinking counter (sum > 0) changes.
   * active=true starts the timer repaint loop; active=false stops it and
   * clears state-0 image overrides on ALL contexts (animateThinking guard
   * removed from the clear path — without this, a stale timer image is
   * stranded on unchecked buttons when the turn ends).
   */
  broadcastThinking(active: boolean): void {
    if (active) {
      this.startAnimation();
      this.renderThinkingFrame();
    } else {
      this.stopAnimation();
      for (const [, ctx] of this.contexts) {
        void ctx.setImage("", 0);
      }
    }
  }

  /**
   * Called by plugin.ts via onArmedChanged when the armed-session context for
   * the stop type changes (new session armed, session cleared, or dismissArmed).
   * Applies the cwd title to all visible On Stop key contexts:
   *   - armed → setTitle(formatAlertTitle(count, latestCwd))
   *   - not armed (null context) → setTitle() no-arg (restore user/manifest title)
   *
   * Follows the broadcastCounts / broadcastThinking precedent.
   */
  broadcastAlertTitle(): void {
    const ctx = this.opts.armedContext?.(this.eventType) ?? null;
    const title = ctx !== null ? formatAlertTitle(ctx.count, ctx.latestCwd) : undefined;
    for (const [, c] of this.contexts) {
      void c.setTitle(title);
    }
  }

  /**
   * Restores state after a Stream Deck page/profile switch.
   * Order per spec: super first (restores alerting from armedMsAgo), then:
   *   - thinking-inactive → setImage("", 0) to clear any stale override.
   *   - thinking-active + animateThinking enabled (default) →
   *     corner sparkle + centered timer.
   *   - thinking-active + animateThinking === false →
   *     timer only (no sparkle).
   */
  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    await super.onWillAppear(ev);
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    // Apply title: only when the base actually re-alerted this button.
    // Expired-budget path sets state IDLE and calls setTitle() — we must not
    // overwrite that with a title. ctx.state.alerting is set by alertContext().
    if (ctx.state.alerting) {
      const armedCtx = this.opts.armedContext?.(this.eventType) ?? null;
      if (armedCtx !== null) {
        void ctx.setTitle(formatAlertTitle(armedCtx.count, armedCtx.latestCwd));
      }
    }
    const isThinking = this.opts.currentThinking?.() ?? false;
    if (!isThinking) {
      void ctx.setImage("", 0);
      return;
    }
    // Thinking active: repaint current frame + elapsed timer.
    // Non-null assertion safe: frameIdx is always kept in-bounds by modulo.
    const frameGlyph = OnStopAction.FRAMES[this.frameIdx]!;
    const elapsedMs = this.opts.currentElapsedMs?.() ?? null;
    const label = elapsedMs !== null ? formatElapsed(elapsedMs) : null;
    const sparkle = ctx.settings.animateThinking !== false ? frameGlyph : null;
    void ctx.setImage(renderThinkingIcon(sparkle, label), 0);
  }
}
