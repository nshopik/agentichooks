import { ACTION_ROUTES } from "./http-listener.js";
import { HTTP_PORT } from "./types.js";

/**
 * Ordered array of action routes available for manual triggering.
 * Derived from ACTION_ROUTES at module load time so the two cannot drift
 * silently — the drift pin in tests/trigger-hook.test.ts enforces this.
 */
export const TRIGGER_ROUTES: ReadonlyArray<string> = [...ACTION_ROUTES].sort();

const TRIGGER_SESSION_ID = "streamdeck-trigger";

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
      body: JSON.stringify({ session_id: TRIGGER_SESSION_ID }),
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
