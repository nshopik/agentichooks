import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import os from "node:os";
import { FlashAction } from "./actions/flash-action.js";
import { SignalWatcher } from "./signal-watcher.js";
import { HttpListener } from "./http-listener.js";
import { AudioPlayer } from "./audio-player.js";
import { Dispatcher } from "./dispatcher.js";
import { defaultSoundPath } from "./system-sounds.js";
import { ALL_EVENT_TYPES, DEFAULT_GLOBAL_SETTINGS, HTTP_PORT, type GlobalSettings } from "./types.js";

// Default to "warn" so the diagnostic info logs (audio: ..., http: ..., dispatcher: ...)
// stay in code but don't fire. Bump to "info" temporarily when investigating issues.
streamDeck.logger.setLevel("warn");

const audioPlayer = new AudioPlayer({
  log: (level, msg) => streamDeck.logger[level](`audio: ${msg}`),
});

let globals: GlobalSettings = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS));

const action = new FlashAction({
  onTestSound: (eventType) => {
    // Plays whatever soundPath resolves to: user pick, runtime default, or
    // nothing if the event was muted (soundPath = "") or has no default (idle
    // without a user pick).
    const cfg = globals.audio[eventType];
    const path = cfg.soundPath ?? defaultSoundPath(eventType);
    streamDeck.logger.info(`onTestSound: event=${eventType} path=${path} vol=${cfg.volumePercent}`);
    if (!path) return;
    audioPlayer.play(path, cfg.volumePercent);
  },
});
streamDeck.actions.registerAction(action);

function mergeGlobals(stored: Partial<GlobalSettings> | undefined): GlobalSettings {
  const base = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS)) as GlobalSettings;
  if (!stored?.audio) return base;
  for (const ev of ALL_EVENT_TYPES) {
    if (stored.audio[ev]) Object.assign(base.audio[ev], stored.audio[ev]);
  }
  return base;
}

async function loadGlobals(): Promise<void> {
  const stored = await streamDeck.settings.getGlobalSettings<JsonObject>();
  globals = mergeGlobals(stored as unknown as Partial<GlobalSettings>);
}

streamDeck.settings.onDidReceiveGlobalSettings<JsonObject>((ev) => {
  globals = mergeGlobals(ev.settings as unknown as Partial<GlobalSettings>);
});

const dispatcher = new Dispatcher({
  audioPlayer,
  getGlobalSettings: () => globals,
  getButtons: () => action.buttonsForDispatcher(),
  log: (msg) => streamDeck.logger.info(`dispatcher: ${msg}`),
});

const watcher = new SignalWatcher({
  tmpDir: os.tmpdir(),
  onSignal: (signal) => {
    if (signal === "active") dispatcher.dismissAll();
    else if (signal === "active-soft") dispatcher.dismiss("permission");
    else dispatcher.dispatch(signal, "local");
  },
});

let listener: HttpListener | undefined;

async function startListener(): Promise<void> {
  listener = new HttpListener({
    port: HTTP_PORT,
    onEvent: (signal) => {
      if (signal === "active") dispatcher.dismissAll();
      else if (signal === "active-soft") dispatcher.dismiss("permission");
      else dispatcher.dispatch(signal, "remote");
    },
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
  watcher.stop();
  if (listener) await listener.stop();
}
process.on("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.on("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });

(async () => {
  await streamDeck.connect();
  await loadGlobals();
  watcher.start();
  await startListener();
  streamDeck.logger.info("Claude Notify plugin started");
})().catch((err) => {
  streamDeck.logger.error(`Plugin startup failed: ${err}`);
  process.exit(1);
});
