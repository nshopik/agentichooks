import { describe, it, expect, vi } from "vitest";
import {
  buildTriggerRequest,
  sendTrigger,
  normalizeTriggerRoute,
  TRIGGER_ROUTES,
} from "../src/trigger-hook.js";

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
});

// ─────────────────────────────────────────────────────────
// sendTrigger
// ─────────────────────────────────────────────────────────

describe("sendTrigger", () => {
  it("calls fetch with the URL and init from buildTriggerRequest", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
    await sendTrigger("/event/stop", fakeFetch);
    expect(fakeFetch).toHaveBeenCalledOnce();
    const [url, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9123/event/stop");
    expect(init.method).toBe("POST");
  });

  it("returns {ok: true, status: 204} when fetch resolves with a 2xx response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
    const result = await sendTrigger("/event/stop", fakeFetch);
    expect(result).toEqual({ ok: true, status: 204 });
  });

  it("returns {ok: false, status: 404} when fetch resolves with a 4xx response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    const result = await sendTrigger("/event/stop", fakeFetch);
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("returns {ok: false, status: 0} when fetch rejects (network error / listener not running)", async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await sendTrigger("/event/stop", fakeFetch);
    expect(result).toEqual({ ok: false, status: 0 });
  });

  it("passes the route through to the URL even if it is not in TRIGGER_ROUTES", async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 } as Response);
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
});
