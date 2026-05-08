export type EventType = "stop" | "idle" | "permission";
export type SignalType = EventType | "active";
export type EventSource = "local" | "remote";

export type FlashSettings = {
  eventType: EventType;
  flashMode: "static" | "pulse";
  pulseIntervalMs: number;
  autoTimeoutMs: number;
};

export type AudioConfig = {
  enabled: boolean;
  soundPath?: string;
  volumePercent: number;
  source: "all" | "remote" | "local";
};

export type GlobalSettings = {
  httpPort: number;
  httpEnabled: boolean;
  audio: {
    stop: AudioConfig;
    idle: AudioConfig;
    permission: AudioConfig;
  };
};

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

const baseAudio: Omit<AudioConfig, "volumePercent"> = {
  enabled: true,
  source: "remote",
};

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  httpPort: 9123,
  httpEnabled: true,
  audio: {
    stop: { ...baseAudio, volumePercent: 80 },
    idle: { ...baseAudio, volumePercent: 80 },
    permission: { ...baseAudio, volumePercent: 90 },
  },
};

export const ALL_EVENT_TYPES: ReadonlyArray<EventType> = ["stop", "idle", "permission"];
