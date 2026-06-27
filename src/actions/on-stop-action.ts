import { action, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { EventType } from "../types.js";
import { renderThinkingIcon, THINKING_FRAMES } from "../render-thinking-icon.js";
import { renderMoonIcon } from "../render-moon-icon.js";
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
  // True while at least one session has a suppressed ("deferred") stop — the
  // turn ended but subagents are still running. Drives the moon visual on the
  // idle state. Set by broadcastWaiting (dispatcher onWaitingChanged). Image
  // precedence on state 0: thinking sparkle/timer > moon > clear — thinking is
  // an active turn and always wins; the moon only shows once the turn is over.
  private waiting = false;
  // Timer repaint loop: fires every 200 ms while thinking is active AND at least
  // one On Stop key context is visible. Advances the sparkle frame AND repaints
  // the elapsed timer on every context. Runs even when every context has
  // animateThinking unchecked (timer still ticks). Stopped by stopAnimation()
  // when the last context disappears (onWillDisappear) or thinking ends
  // (broadcastThinking(false)); restarted from onWillAppear when a context
  // reappears while thinking is active (frameIdx resets to 0 on stop, so the
  // sparkle pulse restarts from the beginning — cosmetic, accepted).
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
   * active=true starts the timer repaint loop and paints the first frame,
   * but only when at least one On Stop key is visible (contexts.size > 0).
   * With zero visible contexts there is nothing to repaint — the interval
   * is deferred until onWillAppear fires and (re)starts it.
   * active=false stops the interval and clears state-0 image overrides on
   * ALL contexts (animateThinking guard removed from the clear path — without
   * this, a stale timer image is stranded on unchecked buttons when the turn
   * ends). Safe to call when contexts is empty (the clear loop is a no-op).
   */
  broadcastThinking(active: boolean): void {
    if (active) {
      if (this.contexts.size > 0) {
        this.startAnimation();
        this.renderThinkingFrame();
      }
    } else {
      this.stopAnimation();
      // Turn ended: fall back to the moon if a stop is still being held for
      // subagents, otherwise clear the state-0 override.
      const img = this.waiting ? renderMoonIcon() : "";
      for (const [, ctx] of this.contexts) {
        void ctx.setImage(img, 0);
      }
    }
  }

  /**
   * Called by plugin.ts via dispatcher onWaitingChanged when the set of sessions
   * with a suppressed stop changes empty↔non-empty. active=true raises the moon
   * "waiting on subagents" visual; active=false lowers it. The moon only paints
   * when no turn is in progress — an active thinking turn owns the state-0 image
   * (sparkle/timer) and its repaint loop would overwrite the moon anyway. When
   * the turn later ends, broadcastThinking(false) repaints the moon from this.waiting.
   */
  broadcastWaiting(active: boolean): void {
    this.waiting = active;
    const thinking = this.opts.currentThinking?.() ?? false;
    if (thinking) return; // sparkle/timer loop owns the image while thinking
    const img = active ? renderMoonIcon() : "";
    for (const [, ctx] of this.contexts) {
      void ctx.setImage(img, 0);
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
    // Coalesce "" → undefined: an armed alert with no resolvable cwd keeps the
    // user/manifest title instead of blanking it (never call setTitle("")).
    const title = (ctx !== null ? formatAlertTitle(ctx.count, ctx.latestCwd) : "") || undefined;
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
        // "" → undefined: same coalesce as broadcastAlertTitle.
        void ctx.setTitle(formatAlertTitle(armedCtx.count, armedCtx.latestCwd) || undefined);
      }
    }
    const isThinking = this.opts.currentThinking?.() ?? false;
    if (!isThinking) {
      // Restore the moon if a stop is being held for subagents, else clear.
      void ctx.setImage(this.waiting ? renderMoonIcon() : "", 0);
      return;
    }
    // Thinking active: (re)start the interval if it was stopped (e.g. page
    // switch while a turn was running), then repaint this context immediately.
    // startAnimation() is idempotent — safe to call if interval already runs.
    this.startAnimation();
    // Non-null assertion safe: frameIdx is always kept in-bounds by modulo.
    const frameGlyph = OnStopAction.FRAMES[this.frameIdx]!;
    const elapsedMs = this.opts.currentElapsedMs?.() ?? null;
    const label = elapsedMs !== null ? formatElapsed(elapsedMs) : null;
    const sparkle = ctx.settings.animateThinking !== false ? frameGlyph : null;
    void ctx.setImage(renderThinkingIcon(sparkle, label), 0);
  }

  /**
   * Stops the animation interval when the last On Stop key context disappears
   * (page or profile switch). super.onWillDisappear removes the context from
   * the map first, so contexts.size reflects the post-removal count.
   * The interval restarts from onWillAppear when a context reappears while
   * thinking is still active.
   */
  override async onWillDisappear(ev: WillDisappearEvent<JsonObject>): Promise<void> {
    await super.onWillDisappear(ev);
    if (this.contexts.size === 0) {
      this.stopAnimation();
    }
  }
}
