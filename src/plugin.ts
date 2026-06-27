import streamDeck from "@elgato/streamdeck";
import fs from "node:fs";
import type { JsonObject } from "@elgato/utils";
import { OnStopAction } from "./actions/on-stop-action.js";
import { OnPermissionAction } from "./actions/on-permission-action.js";
import { OnTaskCompletedAction } from "./actions/on-task-completed-action.js";
import type { EventFlashActionOpts } from "./actions/event-flash-action.js";
import { HttpListener } from "./http-listener.js";
import { AudioPlayer } from "./audio-player.js";
import { Dispatcher, deriveRoute, type DispatchableButton } from "./dispatcher.js";
import { SessionSetCounter } from "./session-set-counter.js";
import { TurnClock } from "./turn-clock.js";
import { defaultSoundPath } from "./system-sounds.js";
import { ALL_EVENT_TYPES, DEFAULT_GLOBAL_SETTINGS, HTTP_PORT, type GlobalSettings, type Logger } from "./types.js";
import { pickLogLevel } from "./log-level.js";

// Default: info. AGENTIC_HOOKS_DEBUG=1 → debug, =trace → trace. When a debugger
// is attached (--inspect* in execArgv), the SDK seeds debug and we leave it
// alone unless AGENTIC_HOOKS_DEBUG=trace upgrades. Note: `npx streamdeck dev`
// does NOT inject --inspect* into the plugin process (verified 2026-05-10) —
// it only enables PI inspection — so the dev branch fires only when the plugin
// is launched via `node --inspect=...`, which is rare in normal use.
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
  // Lazy: taskCounters is constructed below, so these arrows capture the outer
  // binding and resolve at willAppear time. Same indirection pattern as armedMsAgo above.
  currentCount: (): number => taskCounters.tasks.sum(),
  currentThinking: (): boolean => taskCounters.thinking.sum() > 0,
  // Lazy: turnClock is constructed below, so this arrow captures the outer
  // binding and resolves at repaint / willAppear time.
  currentElapsedMs: (): number | null => turnClock.currentElapsedMs(),
  currentAgentCount: (): number => taskCounters.subagents.sum(),
  // Lazy: dispatcher is constructed below. Called when a button's keypress or
  // auto-timeout dismisses an alert; the dispatcher clears ARMED state and
  // dismisses every alerting button of that type (type-wide semantics). Same
  // circular-reference dance as armedMsAgo / currentCount.
  onDismissed: (eventType): void => dispatcher.dismissArmed(eventType),
  // Lazy lookup against the Dispatcher so OnStopAction and OnPermissionAction
  // can compute the cwd title while armed. Dispatcher constructed below.
  armedContext: (eventType) => dispatcher.armedContext(eventType),
};

const stopAction = new OnStopAction(actionOpts);
const permissionAction = new OnPermissionAction(actionOpts);
const taskCompletedAction = new OnTaskCompletedAction(actionOpts);
const actions = [
  stopAction,
  permissionAction,
  taskCompletedAction,
];
for (const a of actions) streamDeck.actions.registerAction(a);

// PI persists alertDelay as { stop: { seconds: 1 }, ... } for human readability,
// matching the autoTimeoutSeconds precedent. Convert to ms once at load time.
type StoredAlertDelay = Partial<Record<typeof ALL_EVENT_TYPES[number], { seconds?: number | string }>>;
type StoredGlobalSettings = Partial<GlobalSettings> & { alertDelay?: StoredAlertDelay };

function mergeGlobals(raw: JsonObject | undefined): GlobalSettings {
  // Single narrowing point for the untyped settings payload — call sites pass
  // the SDK's JsonObject straight through instead of double-casting.
  const stored = raw as StoredGlobalSettings | undefined;
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
  globals = mergeGlobals(stored);
}

streamDeck.settings.onDidReceiveGlobalSettings<JsonObject>((ev) => {
  globals = mergeGlobals(ev.settings);
});

const dispatchLog = makeLogger("dispatch");

// Three id-set counters — declared before Dispatcher so Dispatcher can take
// them as opts. Lazy arrows break the circular reference (counter → dispatcher
// via onSessionDrained / onChanged callbacks, dispatcher → counter via counters opt).
const taskCounters = {
  tasks: new SessionSetCounter({
    name: "tasks",
    // onSessionDrained fires BEFORE onChanged(sum) per spec contract —
    // dispatcher.fireTaskCompleted() is called first so ARMED state is set
    // before the visual layer's broadcastCounts queries it.
    onSessionDrained: (sid) => dispatcher.fireTaskCompleted(sid),
    onChanged: (n) => taskCompletedAction.broadcastCounts(n, taskCounters.subagents.sum()),
    log: makeLogger("counter"),
  }),
  subagents: new SessionSetCounter({
    name: "subagents",
    // When a session's subagents drain to 0, release any Stop that was held back
    // because subagents were still running (the deferred chime). No-op when the
    // session has no held Stop. Fires BEFORE onChanged per the counter contract.
    onSessionDrained: (sid) => dispatcher.fireDeferredStop(sid),
    onChanged: (n) => taskCompletedAction.broadcastCounts(taskCounters.tasks.sum(), n),
    log: makeLogger("counter"),
  }),
  thinking: new SessionSetCounter({
    name: "thinking",
    // Thinking drain is silent — onSessionDrained omitted.
    onChanged: (n) => stopAction.broadcastThinking(n > 0),
    log: makeLogger("counter"),
  }),
};

// TurnClock wraps taskCounters.thinking to record per-session start timestamps.
// Constructed after taskCounters (needs the inner counter) and before dispatcher
// (dispatcher's counters.thinking slot receives the decorator, not the raw counter).
const turnClock = new TurnClock({ inner: taskCounters.thinking });

const dispatcher = new Dispatcher({
  audioPlayer,
  getGlobalSettings: () => globals,
  getButtons: (): Map<string, DispatchableButton> => {
    const merged = new Map<string, DispatchableButton>();
    for (const a of actions) for (const [k, v] of a.buttonsForDispatcher()) merged.set(k, v);
    return merged;
  },
  log: dispatchLog,
  onArmedChanged: (type) => {
    // Broadcast the updated title to all buttons of the affected type.
    // Only stop and permission actions have broadcastAlertTitle — task-completed
    // uses a count badge (no title) and has no consumer for this callback.
    if (type === "stop") stopAction.broadcastAlertTitle();
    else if (type === "permission") permissionAction.broadcastAlertTitle();
  },
  // Raise/lower the moon "waiting on subagents" visual on the stop key as
  // sessions enter/leave the suppressed-stop set.
  onWaitingChanged: (active) => stopAction.broadcastWaiting(active),
  counters: {
    tasks: taskCounters.tasks,
    subagents: taskCounters.subagents,
    // Dispatcher talks to the TurnClock decorator; TurnClock talks to the
    // thinking SessionSetCounter, whose onChanged → broadcastThinking wiring is unchanged.
    thinking: turnClock,
  },
});

let listener: HttpListener | undefined;

async function startListener(): Promise<void> {
  listener = new HttpListener({
    port: HTTP_PORT,
    onEvent: (route, body) => {
      const derived = deriveRoute(route, body?.source, body?.agentId, body?.sessionId);
      if (derived === null) {
        // Distinguish the two drop reasons so log lines remain diagnosable.
        if (!body?.sessionId) {
          dispatchLog.debug(`drop no-session route=${route}`);
        } else {
          dispatchLog.debug(`drop agent-context route=${route} agent=${body?.agentId?.slice(0, 8) ?? "?"}`);
        }
        return;
      }
      dispatcher.handleRoute(derived, body!.sessionId!, { taskId: body?.taskId, agentId: body?.agentId, cwd: body?.cwd });
    },
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
