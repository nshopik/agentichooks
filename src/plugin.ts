import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { FlashAction } from "./actions/flash-action.js";
import { HttpListener } from "./http-listener.js";
import { AudioPlayer } from "./audio-player.js";
import { Dispatcher } from "./dispatcher.js";
import { defaultSoundPath } from "./system-sounds.js";
import { ALL_EVENT_TYPES, DEFAULT_GLOBAL_SETTINGS, HTTP_PORT, type GlobalSettings } from "./types.js";

// CLAUDE_NOTIFY_DEBUG=1 in the plugin's env raises log level from "warn" to "info",
// surfacing every received HTTP event (action + info routes) plus dispatcher and
// audio diagnostic lines. Toggle requires plugin restart:
//   $env:CLAUDE_NOTIFY_DEBUG = "1"; npx streamdeck restart com.nshopik.claudenotify
streamDeck.logger.setLevel(process.env.CLAUDE_NOTIFY_DEBUG ? "info" : "warn");

const audioPlayer = new AudioPlayer({
  log: (level, msg) => streamDeck.logger[level](`audio: ${msg}`),
});

let globals: GlobalSettings = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS));

const action = new FlashAction({
  onTestSound: (eventType) => {
    // Plays whatever soundPath resolves to: user pick, runtime default, or
    // nothing if the event was muted (soundPath = "").
    const cfg = globals.audio[eventType];
    const path = cfg.soundPath ?? defaultSoundPath(eventType);
    streamDeck.logger.info(`onTestSound: event=${eventType} path=${path}`);
    if (!path) return;
    audioPlayer.play(path);
  },
});
streamDeck.actions.registerAction(action);

// PI persists alertDelay as { stop: { seconds: 1 }, ... } for human readability,
// matching the autoTimeoutSeconds precedent. Convert to ms once at load time.
type StoredAlertDelay = Partial<Record<typeof ALL_EVENT_TYPES[number], { seconds?: number | string }>>;
type StoredGlobalSettings = Partial<GlobalSettings> & { alertDelay?: StoredAlertDelay };

function mergeGlobals(stored: StoredGlobalSettings | undefined): GlobalSettings {
  const base = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS)) as GlobalSettings;
  if (!stored) return base;
  if (stored.audio) {
    for (const ev of ALL_EVENT_TYPES) {
      if (stored.audio[ev]) Object.assign(base.audio[ev], stored.audio[ev]);
    }
  }
  if (stored.alertDelay) {
    for (const ev of ALL_EVENT_TYPES) {
      const sec = Number(stored.alertDelay[ev]?.seconds);
      if (Number.isFinite(sec)) base.alertDelay[ev] = Math.max(0, sec * 1000);
    }
  }
  return base;
}

async function loadGlobals(): Promise<void> {
  const stored = await streamDeck.settings.getGlobalSettings<JsonObject>();
  globals = mergeGlobals(stored as unknown as StoredGlobalSettings);
}

streamDeck.settings.onDidReceiveGlobalSettings<JsonObject>((ev) => {
  globals = mergeGlobals(ev.settings as unknown as StoredGlobalSettings);
});

const dispatcher = new Dispatcher({
  audioPlayer,
  getGlobalSettings: () => globals,
  getButtons: () => action.buttonsForDispatcher(),
  log: (msg) => streamDeck.logger.info(`dispatcher: ${msg}`),
});

let listener: HttpListener | undefined;

async function startListener(): Promise<void> {
  listener = new HttpListener({
    port: HTTP_PORT,
    onEvent: (route) => dispatcher.handleRoute(route),
    log: (msg) => streamDeck.logger.info(`http: ${msg}`),
  });
  try {
    await listener.start();
    streamDeck.logger.info(`HTTP listener bound to 127.0.0.1:${HTTP_PORT}`);
  } catch (err) {
    streamDeck.logger.error(`HTTP listener failed to start: ${err}`);
    listener = undefined;
  }
}

async function shutdown(): Promise<void> {
  if (listener) await listener.stop();
}
process.on("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.on("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });

(async () => {
  await streamDeck.connect();
  await loadGlobals();
  await startListener();
  streamDeck.logger.info("Claude Notify plugin started");
})().catch((err) => {
  streamDeck.logger.error(`Plugin startup failed: ${err}`);
  process.exit(1);
});
