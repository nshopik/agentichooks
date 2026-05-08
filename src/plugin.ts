import streamDeck, { LogLevel, type JsonObject } from "@elgato/streamdeck";
import os from "node:os";
import { FlashAction } from "./actions/flash-action.js";
import { SignalWatcher } from "./signal-watcher.js";
import { HttpListener } from "./http-listener.js";
import { AudioPlayer } from "./audio-player.js";
import { Dispatcher } from "./dispatcher.js";
import { defaultSoundPath } from "./system-sounds.js";
import { DEFAULT_GLOBAL_SETTINGS, type GlobalSettings, type EventType } from "./types.js";

streamDeck.logger.setLevel(LogLevel.INFO);

const action = new FlashAction();
streamDeck.actions.registerAction(action);

const audioPlayer = new AudioPlayer();

let globals: GlobalSettings = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS));

function mergeGlobals(stored: Partial<GlobalSettings> | undefined): GlobalSettings {
  const base = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS)) as GlobalSettings;
  if (!stored) return base;
  if (typeof stored.httpPort === "number" || typeof stored.httpPort === "string") {
    const n = Number(stored.httpPort);
    if (!Number.isNaN(n) && n > 0) base.httpPort = n;
  }
  if (typeof stored.httpEnabled === "boolean") base.httpEnabled = stored.httpEnabled;
  if (stored.audio) {
    for (const ev of ["stop", "idle", "permission"] as EventType[]) {
      if (stored.audio[ev]) Object.assign(base.audio[ev], stored.audio[ev]);
    }
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
});

const watcher = new SignalWatcher({
  tmpDir: os.tmpdir(),
  onSignal: (event) => dispatcher.dispatch(event, "local"),
});

let listener: HttpListener | undefined;

async function startListener(): Promise<void> {
  if (!globals.httpEnabled) return;
  listener = new HttpListener({
    port: globals.httpPort,
    onEvent: (event) => dispatcher.dispatch(event, "remote"),
  });
  try {
    await listener.start();
    streamDeck.logger.info(`HTTP listener bound to 127.0.0.1:${globals.httpPort}`);
  } catch (err) {
    streamDeck.logger.error(`HTTP listener failed to start: ${err}`);
    listener = undefined;
  }
}

streamDeck.ui.onSendToPlugin((ev) => {
  const payload = ev.payload as { kind?: string; event?: EventType } | null;
  if (payload?.kind === "test-audio" && payload.event) {
    const cfg = globals.audio[payload.event];
    const path = cfg.soundPath ?? defaultSoundPath(payload.event);
    audioPlayer.play(path, cfg.volumePercent);
  }
});

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
