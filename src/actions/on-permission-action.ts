import { action } from "@elgato/streamdeck";
import type { EventType } from "../types.js";
import { EventFlashAction } from "./event-flash-action.js";

@action({ UUID: "com.nshopik.agentichooks.permission" })
export class OnPermissionAction extends EventFlashAction {
  protected readonly eventType: EventType = "permission";
}
