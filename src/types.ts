export type EventType = "stop" | "idle" | "permission" | "task-completed";
export type SignalType = EventType | "active" | "active-soft";

export type EventSource = "local" | "remote";

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
    idle: AudioConfig;
    permission: AudioConfig;
    "task-completed": AudioConfig;
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
  eventType: "idle",
  flashMode: "static",
  pulseIntervalMs: 500,
  autoTimeoutMs: 0,
};

// Per-event-type default for autoTimeoutMs. task-completed self-clears after 30s
// because no Claude Code hook reliably fires after the task completion that we
// can use as a dismiss signal short of the next prompt.
export const DEFAULT_AUTO_TIMEOUT_BY_EVENT: Record<EventType, number> = {
  stop: 0,
  idle: 0,
  permission: 0,
  "task-completed": 30_000,
};

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  audio: {
    stop: { volumePercent: 80 },
    idle: { volumePercent: 80 },
    permission: { volumePercent: 90 },
    "task-completed": { volumePercent: 80 },
  },
};

export const ALL_EVENT_TYPES: ReadonlyArray<EventType> = ["stop", "idle", "permission", "task-completed"];
