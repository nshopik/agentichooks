import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { HttpListener } from "../src/http-listener.js";

let listener: HttpListener | undefined;
let received: string[];
let logs: { level: string; msg: string }[];

async function requestWithBody(
  method: string,
  path: string,
  port: number,
  body: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const bodyBuf = Buffer.from(body, "utf8");
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": bodyBuf.length,
        },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

function makeLog() {
  return {
    debug: (msg: string) => logs.push({ level: "debug", msg }),
    info:  (msg: string) => logs.push({ level: "info",  msg }),
    warn:  (msg: string) => logs.push({ level: "warn",  msg }),
    trace: (msg: string) => logs.push({ level: "trace", msg }),
    error: (msg: string) => logs.push({ level: "error", msg }),
  };
}

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

const ACTION_ROUTES = [
  "/event/stop",
  "/event/stop-failure",
  "/event/permission-request",
  "/event/task-completed",
  "/event/task-created",
  "/event/session-start",
  "/event/user-prompt-submit",
  "/event/permission-denied",
  "/event/post-tool-use",
  "/event/post-tool-use-failure",
  "/event/pre-tool-use",
  "/event/session-end",
];

const INFO_ROUTES = [
  "/event/notification",
  "/event/post-tool-batch",
  "/event/subagent-start",
  "/event/subagent-stop",
  "/event/setup",
  "/event/instructions-loaded",
  "/event/user-prompt-expansion",
  "/event/teammate-idle",
  "/event/config-change",
  "/event/cwd-changed",
  "/event/file-changed",
  "/event/worktree-create",
  "/event/worktree-remove",
  "/event/pre-compact",
  "/event/post-compact",
  "/event/elicitation",
  "/event/elicitation-result",
];

const REMOVED_ROUTES = [
  "/event/permission",
  "/event/active",
  "/event/permission-resolved",
];

beforeEach(() => {
  received = [];
  logs = [];
});

afterEach(async () => {
  if (listener) {
    await listener.stop();
    listener = undefined;
  }
});

describe("HttpListener", () => {
  it.each(ACTION_ROUTES)("POST %s returns 204 and forwards the URL to onEvent", async (path) => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    const res = await request("POST", path, listener.port());
    expect(res.status).toBe(204);
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([path]);
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
    expect(received).toEqual(["/event/stop", "/event/permission-request", "/event/session-start"]);
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

  it("POST with empty body on a signal route emits WARN and INFO result with session=? cwd=?", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    await request("POST", "/event/stop", listener.port());
    await new Promise((r) => setTimeout(r, 20));
    const warn = logs.find((l) => l.level === "warn");
    expect(warn?.msg).toMatch(/empty body/);
    expect(warn?.msg).toMatch(/route=\/event\/stop/);
    const info = logs.find((l) => l.level === "info" && l.msg.includes("route="));
    expect(info?.msg).toContain("session=?");
    expect(info?.msg).toContain("cwd=?");
  });

  it("POST with unparseable body on a signal route emits WARN and INFO result with session=? cwd=?", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    await requestWithBody("POST", "/event/stop", listener.port(), "not-json");
    await new Promise((r) => setTimeout(r, 20));
    const warn = logs.find((l) => l.level === "warn");
    expect(warn?.msg).toMatch(/unparseable body/);
    const info = logs.find((l) => l.level === "info" && l.msg.includes("route="));
    expect(info?.msg).toContain("session=?");
    expect(info?.msg).toContain("cwd=?");
  });

  it("POST with oversize body on a signal route emits WARN and INFO result with session=? cwd=?", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    // Send 65 KB of valid-looking JSON chars (will exceed the 64 KB cap)
    const big = "{" + '"a":"' + "x".repeat(65 * 1024) + '"}';
    await requestWithBody("POST", "/event/stop", listener.port(), big);
    await new Promise((r) => setTimeout(r, 20));
    const warn = logs.find((l) => l.level === "warn");
    expect(warn?.msg).toMatch(/oversize body/);
    const info = logs.find((l) => l.level === "info" && l.msg.includes("route="));
    expect(info?.msg).toContain("session=?");
    expect(info?.msg).toContain("cwd=?");
  });

  it("POST with valid parsed body on a signal route shows 8-char session and cwd basename in INFO", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    const body = JSON.stringify({ session_id: "a1b2c3d4e5f6", cwd: "/home/user/myproject" });
    await requestWithBody("POST", "/event/stop", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const info = logs.find((l) => l.level === "info" && l.msg.includes("route="));
    expect(info?.msg).toContain("session=a1b2c3d4");
    expect(info?.msg).toContain("cwd=myproject");
  });

  it("signal route (/event/stop) emits result line at INFO level", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    const body = JSON.stringify({ session_id: "abc", cwd: "/a/b" });
    await requestWithBody("POST", "/event/stop", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const resultLine = logs.find((l) => l.msg.includes("route=/event/stop") && l.msg.includes("session="));
    expect(resultLine?.level).toBe("info");
  });

  it("verbose route (/event/pre-tool-use) emits result line at DEBUG level", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    const body = JSON.stringify({ session_id: "abc", cwd: "/a/b" });
    await requestWithBody("POST", "/event/pre-tool-use", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const resultLine = logs.find((l) => l.msg.includes("route=/event/pre-tool-use") && l.msg.includes("session="));
    expect(resultLine?.level).toBe("debug");
  });

  it("/event/notification with message field emits second INFO line with escaped message text", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    const body = JSON.stringify({ session_id: "abc", cwd: "/a/b", message: 'Claude needs "your" attention' });
    await requestWithBody("POST", "/event/notification", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const notifLine = logs.find((l) => l.level === "info" && l.msg.includes("notification message="));
    expect(notifLine?.msg).toContain('"Claude needs \\"your\\" attention"');
  });
});
