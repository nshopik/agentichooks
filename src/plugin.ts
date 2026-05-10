import streamDeck from "@elgato/streamdeck";
import fs from "node:fs";
import type { JsonObject } from "@elgato/utils";
import { OnStopAction } from "./actions/on-stop-action.js";
import { OnPermissionAction } from "./actions/on-permission-action.js";
import { OnTaskCompletedAction } from "./actions/on-task-completed-action.js";
import type { EventFlashActionOpts } from "./actions/event-flash-action.js";
import { HttpListener } from "./http-listener.js";
import { AudioPlayer } from "./audio-player.js";
import { Dispatcher, type DispatchableButton } from "./dispatcher.js";
import { TaskCounter } from "./task-counter.js";
import { defaultSoundPath } from "./system-sounds.js";
import { ALL_EVENT_TYPES, DEFAULT_GLOBAL_SETTINGS, HTTP_PORT, type GlobalSettings, type Logger } from "./types.js";
import { pickLogLevel } from "./log-level.js";

// Out of dev: default info, AGENTIC_HOOKS_DEBUG=1 → debug, =trace → trace.
// In dev (Stream Deck launches plugin with --inspect*), the SDK seeds debug;
// we only override when AGENTIC_HOOKS_DEBUG=trace asks for trace dumps.
const level = pickLogLevel(process.execArgv, process.env);
if (level) streamDeck.logger.setLevel(level);

// Builds a scoped Logger that mirrors debug/trace calls to console.debug, so a
// dev with a terminal open sees them immediately without restarting the plugin
// to bump the log file's level. info/warn/error stay log-file-only (the SDK's
// defaults already write them to terminal at debug level in dev mode).
function makeLogger(scope: string): Logger {
  const scoped = streamDeck.logger.createScope(scope);
  return {
    info:  (msg) => scoped.info(msg),
    warn:  (msg) => scoped.warn(msg),
    error: (msg) => scoped.error(msg),
    debug: (msg) => { scoped.debug(msg); console.debug(`[${scope}] ${msg}`); },
    trace: (msg) => { scoped.trace(msg); console.debug(`[${scope}] TRACE ${msg}`); },
  };
}

const audioPlayer = new AudioPlayer({
  log: makeLogger("audio"),
});

let globals: GlobalSettings = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS));

const actionOpts: EventFlashActionOpts = {
  onTestSound: (eventType): boolean => {
    // Plays whatever soundPath resolves to: user pick, runtime default, or
    // nothing if the event was muted (soundPath = "") or the file is gone.
    // Returns true when playback actually started, false otherwise — the PI's
    // ▶ Test sound button uses the false result to call showAlert().
    const cfg = globals.audio[eventType];
    const soundPath = cfg.soundPath ?? defaultSoundPath(eventType);
    streamDeck.logger.info(`onTestSound: event=${eventType} path=${soundPath}`);
    if (!soundPath) return false;
    if (!fs.existsSync(soundPath)) return false;
    audioPlayer.play(soundPath);
    return true;
  },
  // Lazy lookup: dispatcher is constructed below, so this arrow captures the
  // outer binding and resolves at willAppear time. Lets the action restore
  // alerting state for buttons revealed by a page or profile switch. The
  // explicit return type breaks a TS inference cycle (action ↔ dispatcher).
  armedMsAgo: (eventType): number | null => dispatcher.armedMsAgo(eventType),
  // Lazy: taskCounter is constructed below, so this arrow captures the outer
  // binding and resolves at willAppear time. Same indirection pattern as
  // armedMsAgo above.
  currentCount: (): number => taskCounter.current(),
  // !==false treats both undefined (not yet set) and true as enabled — default on.
  animateEnabled: (): boolean => globals.animateCounter !== false,
};

const taskCompletedAction = new OnTaskCompletedAction(actionOpts);
const actions = [
  new OnStopAction(actionOpts),
  new OnPermissionAction(actionOpts),
  taskCompletedAction,
];
for (const a of actions) streamDeck.actions.registerAction(a);

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
  if (stored.animateCounter !== undefined) base.animateCounter = stored.animateCounter;
  return base;
}

async function loadGlobals(): Promise<void> {
  const stored = await streamDeck.settings.getGlobalSettings<JsonObject>();
  globals = mergeGlobals(stored as unknown as StoredGlobalSettings);
}

streamDeck.settings.onDidReceiveGlobalSettings<JsonObject>((ev) => {
  globals = mergeGlobals(ev.settings as unknown as StoredGlobalSettings);
});

// Construct the counter before the dispatcher so the dispatcher can take
// it as an opt. onZeroReached uses a lazy arrow because dispatcher is
// declared on the next line — same circular-reference dance as armedMsAgo.
const taskCounter = new TaskCounter({
  onCountChanged: (n) => taskCompletedAction.broadcastCount(n),
  onZeroReached: () => dispatcher.fireTaskCompleted(),
  log: makeLogger("counter"),
});

const dispatcher = new Dispatcher({
  audioPlayer,
  getGlobalSettings: () => globals,
  getButtons: (): Map<string, DispatchableButton> => {
    const merged = new Map<string, DispatchableButton>();
    for (const a of actions) for (const [k, v] of a.buttonsForDispatcher()) merged.set(k, v);
    return merged;
  },
  log: makeLogger("dispatch"),
  taskCounter,
});

let listener: HttpListener | undefined;

async function startListener(): Promise<void> {
  listener = new HttpListener({
    port: HTTP_PORT,
    onEvent: (route) => dispatcher.handleRoute(route),
    log: makeLogger("http"),
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
  streamDeck.settings.useExperimentalMessageIdentifiers = true;
  await streamDeck.connect();
  await loadGlobals();
  await startListener();
  streamDeck.logger.info("Agentic Hooks plugin started");
})().catch((err) => {
  streamDeck.logger.error(`Plugin startup failed: ${err}`);
  process.exit(1);
});
