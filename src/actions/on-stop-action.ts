import { action, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { EventType } from "../types.js";
import { renderThinkingIcon, THINKING_FRAMES } from "../render-thinking-icon.js";
import { EventFlashAction } from "./event-flash-action.js";

@action({ UUID: "com.nshopik.agentichooks.stop" })
export class OnStopAction extends EventFlashAction {
  protected readonly eventType: EventType = "stop";

  // 8-frame pulse at 200 ms per frame = 5 fps; within Stream Deck's 10 fps cap.
  // The sequence is the sparkle-motif pulse from the spec.
  private static readonly FRAMES = THINKING_FRAMES;

  private frameIdx = 0;
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
   * Re-render every enabled On Stop key context with the current thinking frame.
   * animateThinking defaults ON: undefined is treated as true (`!== false`, the
   * animateCounter precedent); only contexts where the user unchecked the PI
   * checkbox are left showing their manifest/user idle image.
   *
   * Alert/thinking precedence: thinking paints via setImage(..., 0) (idle state).
   * The armed flash owns state 1. An armed alert always wins visually; the thinking
   * image is queued under state 0 and is revealed on dismiss — correct under
   * multi-session overlap where stop-failure arms the alert for session A while
   * session B is still thinking.
   */
  private renderThinkingFrame(): void {
    // Non-null assertion safe: frameIdx is always kept in-bounds by modulo.
    const frameGlyph = OnStopAction.FRAMES[this.frameIdx]!;
    for (const [, ctx] of this.contexts) {
      if (ctx.settings.animateThinking !== false) {
        void ctx.setImage(renderThinkingIcon(frameGlyph), 0);
      }
    }
  }

  /**
   * Called by plugin.ts when the thinking counter (sum > 0) changes.
   * active=true starts the animation; active=false stops it and clears state-0
   * image overrides on enabled contexts.
   */
  broadcastThinking(active: boolean): void {
    if (active) {
      this.startAnimation();
      this.renderThinkingFrame();
    } else {
      this.stopAnimation();
      for (const [, ctx] of this.contexts) {
        if (ctx.settings.animateThinking !== false) {
          void ctx.setImage("", 0);
        }
      }
    }
  }

  /**
   * Restores state after a Stream Deck page/profile switch.
   * Order per spec: super first (restores alerting from armedMsAgo), then:
   *   - thinking-inactive OR animateThinking unchecked → setImage("", 0) to clear any
   *     stale override (harmless no-op when no override exists).
   *   - thinking-active + animateThinking enabled (default) → repaint current frame.
   */
  override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
    await super.onWillAppear(ev);
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    const isThinking = this.opts.currentThinking?.() ?? false;
    if (!isThinking || ctx.settings.animateThinking === false) {
      void ctx.setImage("", 0);
      return;
    }
    // Thinking active + enabled: repaint current frame.
    // Non-null assertion safe: frameIdx is always kept in-bounds by modulo.
    const frameGlyph = OnStopAction.FRAMES[this.frameIdx]!;
    void ctx.setImage(renderThinkingIcon(frameGlyph), 0);
  }
}
