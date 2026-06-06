import streamDeck, {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { sendTrigger, normalizeTriggerRoute } from "../trigger-hook.js";

type TriggerSettings = JsonObject & {
  route?: unknown;
};

@action({ UUID: "com.nshopik.agentichooks.trigger" })
export class TriggerHookAction extends SingletonAction<TriggerSettings> {
  // Per-button route cache — avoids reading raw settings on every key press.
  private routes = new Map<string, string>();

  override async onWillAppear(ev: WillAppearEvent<TriggerSettings>): Promise<void> {
    const route = normalizeTriggerRoute(ev.payload.settings.route);
    this.routes.set(ev.action.id, route);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TriggerSettings>): Promise<void> {
    const route = normalizeTriggerRoute(ev.payload.settings.route);
    this.routes.set(ev.action.id, route);
  }

  override async onKeyDown(ev: KeyDownEvent<TriggerSettings>): Promise<void> {
    const route = this.routes.get(ev.action.id) ?? normalizeTriggerRoute(undefined);
    streamDeck.logger.debug(`[trigger] key-press route=${route}`);
    const result = await sendTrigger(route, fetch);
    if (result.ok) {
      await ev.action.showOk();
    } else {
      streamDeck.logger.warn(`[trigger] POST failed route=${route} status=${result.status}`);
      await ev.action.showAlert();
    }
  }
}
