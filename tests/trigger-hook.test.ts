import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import {
  buildTriggerRequest,
  sendTrigger,
  normalizeTriggerRoute,
  TRIGGER_ROUTES,
} from "../src/trigger-hook.js";
import { ACTION_ROUTES } from "../src/http-listener.js";

// ─────────────────────────────────────────────────────────
// buildTriggerRequest
// ─────────────────────────────────────────────────────────

describe("buildTriggerRequest", () => {
  it("returns a URL pointing at 127.0.0.1:9123 for a known route", () => {
    const { url } = buildTriggerRequest("/event/stop");
    expect(url).toBe("http://127.0.0.1:9123/event/stop");
  });

  it("returns a URL for every TRIGGER_ROUTES member", () => {
    for (const route of TRIGGER_ROUTES) {
      const { url } = buildTriggerRequest(route);
      expect(url).toBe(`http://127.0.0.1:9123${route}`);
    }
  });

  it("init method is POST", () => {
    const { init } = buildTriggerRequest("/event/stop");
    expect(init.method).toBe("POST");
  });

  it("init Content-Type header is application/json", () => {
    const { init } = buildTriggerRequest("/event/stop");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("init body contains session_id streamdeck-trigger", () => {
    const { init } = buildTriggerRequest("/event/stop");
    const parsed = JSON.parse(init.body as string);
    expect(parsed.session_id).toBe("streamdeck-trigger");
  });

  it("works for any route string (passthrough, no validation)", () => {
    const { url } = buildTriggerRequest("/event/permission-request");
    expect(url).toBe("http://127.0.0.1:9123/event/permission-request");
  });

  // ── Per-route synthetic id injection (missing-id gate regression guard) ──
  // The dispatcher requires task_id for task-created/task-completed and agent_id
  // for subagent-start/subagent-stop. Without these, the routes are WARN-dropped.

  it("task-created body includes task_id: 'streamdeck-trigger' and session_id", () => {
    const { init } = buildTriggerRequest("/event/task-created");
    const parsed = JSON.parse(init.body as string);
    expect(parsed.task_id).toBe("streamdeck-trigger");
    expect(parsed.session_id).toBe("streamdeck-trigger");
  });

  it("task-completed body includes task_id: 'streamdeck-trigger'", () => {
    const { init } = buildTriggerRequest("/event/task-completed");
    const parsed = JSON.parse(init.body as string);
    expect(parsed.task_id).toBe("streamdeck-trigger");
  });

  it("subagent-start body includes agent_id: 'streamdeck-trigger' and NO task_id", () => {
    const { init } = buildTriggerRequest("/event/subagent-start");
    const parsed = JSON.parse(init.body as string);
    expect(parsed.agent_id).toBe("streamdeck-trigger");
    expect(parsed.task_id).toBeUndefined();
  });

  it("subagent-stop body includes agent_id: 'streamdeck-trigger'", () => {
    const { init } = buildTriggerRequest("/event/subagent-stop");
    const parsed = JSON.parse(init.body as string);
    expect(parsed.agent_id).toBe("streamdeck-trigger");
  });

  it("/event/stop body has NO task_id and NO agent_id (agent-context-drop regression guard)", () => {
    // CRITICAL: adding agent_id to /event/stop would cause deriveRoute to drop it
    // (agent-context check), silently breaking the stop alert trigger.
    const { init } = buildTriggerRequest("/event/stop");
    const parsed = JSON.parse(init.body as string);
    expect(parsed.task_id).toBeUndefined();
    expect(parsed.agent_id).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────
// sendTrigger
// ─────────────────────────────────────────────────────────

describe("sendTrigger", () => {
  it("calls fetch with the URL and init from buildTriggerRequest", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    await sendTrigger("/event/stop", fakeFetch);
    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9123/event/stop");
    expect(init.method).toBe("POST");
  });

  it("returns {ok: true, status: 204} when fetch resolves with a 2xx response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    const result = await sendTrigger("/event/stop", fakeFetch);
    expect(result).toEqual({ ok: true, status: 204 });
  });

  it("returns {ok: false, status: 404} when fetch resolves with a 4xx response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const result = await sendTrigger("/event/stop", fakeFetch);
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("returns {ok: false, status: 0} when fetch rejects (network error / listener not running)", async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await sendTrigger("/event/stop", fakeFetch);
    expect(result).toEqual({ ok: false, status: 0 });
  });

  it("passes the route through to the URL even if it is not in TRIGGER_ROUTES", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    await sendTrigger("/event/unknown-route", fakeFetch);
    const [url] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9123/event/unknown-route");
  });
});

// ─────────────────────────────────────────────────────────
// normalizeTriggerRoute
// ─────────────────────────────────────────────────────────

describe("normalizeTriggerRoute", () => {
  it("returns a known route string unchanged", () => {
    expect(normalizeTriggerRoute("/event/stop")).toBe("/event/stop");
  });

  it("returns /event/stop for undefined (missing setting)", () => {
    expect(normalizeTriggerRoute(undefined)).toBe("/event/stop");
  });

  it("returns /event/stop for null", () => {
    expect(normalizeTriggerRoute(null)).toBe("/event/stop");
  });

  it("returns /event/stop for an empty string", () => {
    expect(normalizeTriggerRoute("")).toBe("/event/stop");
  });

  it("returns /event/stop for a numeric value", () => {
    expect(normalizeTriggerRoute(42)).toBe("/event/stop");
  });

  it("returns /event/stop for an unknown string not in TRIGGER_ROUTES", () => {
    expect(normalizeTriggerRoute("/event/does-not-exist")).toBe("/event/stop");
  });

  it("accepts every member of TRIGGER_ROUTES", () => {
    for (const route of TRIGGER_ROUTES) {
      expect(normalizeTriggerRoute(route)).toBe(route);
    }
  });
});

// ─────────────────────────────────────────────────────────
// TRIGGER_ROUTES shape
// ─────────────────────────────────────────────────────────

describe("TRIGGER_ROUTES", () => {
  it("is a non-empty array of strings", () => {
    expect(Array.isArray(TRIGGER_ROUTES)).toBe(true);
    expect(TRIGGER_ROUTES.length).toBeGreaterThan(0);
    for (const r of TRIGGER_ROUTES) {
      expect(typeof r).toBe("string");
    }
  });

  it("every entry starts with /event/", () => {
    for (const r of TRIGGER_ROUTES) {
      expect(r).toMatch(/^\/event\//);
    }
  });

  it("contains /event/stop (the default route)", () => {
    expect(TRIGGER_ROUTES).toContain("/event/stop");
  });

  it("contains /event/permission-request", () => {
    expect(TRIGGER_ROUTES).toContain("/event/permission-request");
  });

  it("contains /event/session-start", () => {
    expect(TRIGGER_ROUTES).toContain("/event/session-start");
  });

  it("equals the sorted ACTION_ROUTES set (derivation pin)", () => {
    expect([...TRIGGER_ROUTES]).toEqual([...ACTION_ROUTES].sort());
  });
});

// ─────────────────────────────────────────────────────────
// PI drift pin — every ACTION_ROUTES member must appear in ui/trigger.html
// ─────────────────────────────────────────────────────────
// This test reads the PI HTML from disk and asserts that every route in
// ACTION_ROUTES has a corresponding <option> element. If a route is added
// to ACTION_ROUTES without updating the PI, this test fails loudly rather
// than silently producing a broken dropdown.

describe("ui/trigger.html — PI route drift pin", () => {
  let html = "";

  try {
    html = readFileSync(
      new URL("../com.nshopik.agentichooks.sdPlugin/ui/trigger.html", import.meta.url),
      "utf8",
    );
  } catch {
    html = "";
  }

  it("ui/trigger.html exists and is non-empty", () => {
    expect(html.length).toBeGreaterThan(0);
  });

  it.each([...ACTION_ROUTES])(
    "ACTION_ROUTE %s has a matching <option value> in ui/trigger.html",
    (route) => {
      // Match  value="/event/stop"  or  value='/event/stop'
      const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = new RegExp(`value=["']${escaped}["']`);
      expect(html).toMatch(pattern);
    },
  );
});
