export type EventType = "stop" | "permission" | "task-completed";

export type FlashSettings = {
  eventType: EventType;
  flashMode: "static" | "pulse";
  pulseIntervalMs: number;
  autoTimeoutMs: number;
};

export type AudioConfig = {
  soundPath?: string;
  volumePercent: number;
};

export type GlobalSettings = {
  audio: {
    stop: AudioConfig;
    permission: AudioConfig;
    "task-completed": AudioConfig;
  };
  alertDelay: {
    stop: number;
    permission: number;
    "task-completed": number;
  };
};

export const HTTP_PORT = 9123;

export type ButtonState = {
  alerting: boolean;
  pulseTimer?: NodeJS.Timeout;
  timeoutTimer?: NodeJS.Timeout;
  pulseFrame: 0 | 1;
};

export const DEFAULT_FLASH_SETTINGS: FlashSettings = {
  eventType: "stop",
  flashMode: "static",
  pulseIntervalMs: 500,
  autoTimeoutMs: 0,
};

// Per-event-type default for autoTimeoutMs. task-completed self-clears after 30s
// because no Claude Code hook reliably fires after the task completion that we
// can use as a dismiss signal short of the next prompt.
export const DEFAULT_AUTO_TIMEOUT_BY_EVENT: Record<EventType, number> = {
  stop: 0,
  permission: 0,
  "task-completed": 30_000,
};

// Default per-event-type delay (ms) between an arming route arriving and the
// alert (audio + flash) actually firing. A clearing route arriving inside this
// window cancels the pending alert entirely — fixes the false-positive sound
// when PermissionRequest → PostToolUse fires within ~1s.
export const DEFAULT_ALERT_DELAY_MS = 1000;

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  audio: {
    stop: { volumePercent: 80 },
    permission: { volumePercent: 90 },
    "task-completed": { volumePercent: 80 },
  },
  alertDelay: {
    stop: DEFAULT_ALERT_DELAY_MS,
    permission: DEFAULT_ALERT_DELAY_MS,
    "task-completed": DEFAULT_ALERT_DELAY_MS,
  },
};

export const ALL_EVENT_TYPES: ReadonlyArray<EventType> = ["stop", "permission", "task-completed"];
