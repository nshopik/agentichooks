import { ACTION_ROUTES } from "./http-listener.js";
import { HTTP_PORT } from "./types.js";

/**
 * Ordered array of action routes available for manual triggering.
 * Derived from ACTION_ROUTES at module load time so the two cannot drift
 * silently — the drift pin in tests/trigger-hook.test.ts enforces this.
 */
export const TRIGGER_ROUTES: ReadonlyArray<string> = [...ACTION_ROUTES].sort();

const TRIGGER_SESSION_ID = "streamdeck-trigger";

// Per-route synthetic id injection.
//
// The dispatcher's missing-id gate drops routes whose counter entries require
// an id (task_id for task-created/task-completed; agent_id for subagent-start/
// subagent-stop) when that id is absent from the body. Without this, pressing a
// Trigger Hook key for any of these four routes silently produces a WARN-drop.
//
// The fixed id value is deliberately idempotent under the dispatcher's Set
// semantics: repeated task-created presses don't inflate the in-flight count
// (Set.add("streamdeck-trigger") is a no-op on re-insertion), and a create →
// complete round-trip exercises the chime correctly (add then remove).
//
// CRITICAL: agent_id must NOT be added to any other route — deriveRoute's
// agent-context check would drop /event/stop carrying agent_id, breaking
// the stop alert trigger. Per-route selection only.
function buildBody(route: string): Record<string, string> {
  if (route === "/event/task-created" || route === "/event/task-completed") {
    return { session_id: TRIGGER_SESSION_ID, task_id: TRIGGER_SESSION_ID };
  }
  if (route === "/event/subagent-start" || route === "/event/subagent-stop") {
    return { session_id: TRIGGER_SESSION_ID, agent_id: TRIGGER_SESSION_ID };
  }
  return { session_id: TRIGGER_SESSION_ID };
}

/**
 * Builds the fetch URL and RequestInit for a trigger POST.
 * Pure function — no network I/O, no side effects.
 */
export function buildTriggerRequest(route: string): { url: string; init: RequestInit } {
  return {
    url: `http://127.0.0.1:${HTTP_PORT}${route}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(route)),
    },
  };
}

/**
 * Sends a trigger POST to the local listener.
 * Accepts an injected fetchFn for testing; production callers pass globalThis.fetch.
 * Never throws — network errors are caught and returned as {ok: false, status: 0}.
 */
export async function sendTrigger(
  route: string,
  fetchFn: (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status">>,
): Promise<{ ok: boolean; status: number }> {
  const { url, init } = buildTriggerRequest(route);
  try {
    const res = await fetchFn(url, init);
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * Safe deserializer for the `route` setting arriving from the Property Inspector.
 * Unknown/missing values fall back to the default route (/event/stop).
 * Mirrors the normalizeFlashMode pattern in src/types.ts.
 */
export function normalizeTriggerRoute(raw: unknown): string {
  if (typeof raw === "string" && (TRIGGER_ROUTES as ReadonlyArray<string>).includes(raw)) {
    return raw;
  }
  return "/event/stop";
}
