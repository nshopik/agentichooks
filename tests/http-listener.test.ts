import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { HttpListener } from "../src/http-listener.js";
import type { SignalType } from "../src/types.js";

let listener: HttpListener | undefined;
let received: SignalType[];

async function request(method: string, path: string, port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

const ACTION_ROUTES: Array<[string, SignalType]> = [
  ["/event/stop", "stop"],
  ["/event/stop-failure", "stop"],
  ["/event/permission-request", "permission"],
  ["/event/task-completed", "task-completed"],
  ["/event/session-start", "active"],
  ["/event/user-prompt-submit", "active"],
  ["/event/permission-denied", "permission-resolved"],
  ["/event/post-tool-use", "permission-resolved"],
  ["/event/post-tool-use-failure", "permission-resolved"],
];

const INFO_ROUTES = [
  "/event/notification",
  "/event/pre-tool-use",
  "/event/post-tool-batch",
  "/event/subagent-start",
  "/event/subagent-stop",
  "/event/task-created",
];

const REMOVED_ROUTES = [
  "/event/permission",
  "/event/active",
  "/event/permission-resolved",
];

beforeEach(() => {
  received = [];
});

afterEach(async () => {
  if (listener) {
    await listener.stop();
    listener = undefined;
  }
});

describe("HttpListener", () => {
  it.each(ACTION_ROUTES)("POST %s returns 204 and calls onEvent('%s')", async (path, signal) => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    const res = await request("POST", path, listener.port());
    expect(res.status).toBe(204);
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([signal]);
  });

  it.each(INFO_ROUTES)("POST %s returns 204 without calling onEvent", async (path) => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    const res = await request("POST", path, listener.port());
    expect(res.status).toBe(204);
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([]);
  });

  it.each(REMOVED_ROUTES)("POST %s returns 404 (route was removed)", async (path) => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    const res = await request("POST", path, listener.port());
    expect(res.status).toBe(404);
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([]);
  });

  it("dispatches multiple events in arrival order", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    const port = listener.port();
    await request("POST", "/event/stop", port);
    await request("POST", "/event/permission-request", port);
    await request("POST", "/event/session-start", port);
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual(["stop", "permission", "active"]);
  });

  it("GET /health returns 200 OK", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    const res = await request("GET", "/health", listener.port());
    expect(res.status).toBe(200);
    expect(res.body).toBe("OK");
  });

  it("returns 404 for unknown paths", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    const res = await request("GET", "/nope", listener.port());
    expect(res.status).toBe(404);
  });

  it("returns 405 for GET on POST-only action routes", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    const res = await request("GET", "/event/stop", listener.port());
    expect(res.status).toBe(405);
    expect(received).toEqual([]);
  });

  it("returns 405 for GET on POST-only info routes", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    const res = await request("GET", "/event/notification", listener.port());
    expect(res.status).toBe(405);
    expect(received).toEqual([]);
  });

  it("binds to 127.0.0.1 only", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const addr = (listener as any).server.address();
    expect(addr.address).toBe("127.0.0.1");
  });
});
