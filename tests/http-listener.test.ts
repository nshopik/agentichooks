import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import net from "node:net";
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

async function requestWithHeaders(
  method: string,
  path: string,
  port: number,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
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

  it("POST /event/task-completed-agent returns 404 (synthetic route — unreachable via direct POST)", async () => {
    // /event/task-completed-agent is a synthetic ROUTES key reachable only via
    // deriveRoute() for agent-context task-completed events. A direct POST must
    // 404, mirroring the /event/session-start-soft unreachability guarantee.
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    const res = await request("POST", "/event/task-completed-agent", listener.port());
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

  it("resolvedPort field is set after start() and matches port()", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
    await listener.start();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const field = (listener as any).resolvedPort as number;
    expect(typeof field).toBe("number");
    expect(field).toBeGreaterThan(0);
    expect(field).toBe(listener.port());
  });

  it("POST with empty body on a signal route emits WARN and INFO result with session=? cwd=?", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    await request("POST", "/event/stop", listener.port());
    await new Promise((r) => setTimeout(r, 20));
    const warn = logs.find((l) => l.level === "warn");
    expect(warn?.msg).toMatch(/empty body/);
    expect(warn?.msg).toMatch(/route=\/event\/stop/);
    expect(warn?.msg).toContain("(session_id required)");
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
    expect(warn?.msg).toContain("(session_id required)");
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
    expect(warn?.msg).toContain("(session_id required)");
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

  it("POST /event/stop with Origin header returns 403 and does not call onEvent", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    const res = await requestWithHeaders("POST", "/event/stop", listener.port(), {
      "Origin": "http://attacker.example",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(res.status).toBe(403);
    expect(received).toEqual([]);
    const warns = logs.filter((l) => l.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain("reason=origin");
  });

  it("POST /event/stop with non-loopback Host header returns 403 and does not call onEvent", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    const res = await requestWithHeaders("POST", "/event/stop", listener.port(), {
      "Host": "attacker.example",
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(res.status).toBe(403);
    expect(received).toEqual([]);
    const warns = logs.filter((l) => l.level === "warn");
    expect(warns).toHaveLength(1);
    expect(warns[0].msg).toContain("reason=host");
  });

  it("POST /event/stop with Host: localhost:<port> returns 204 and calls onEvent", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    const port = listener.port();
    const res = await requestWithHeaders("POST", "/event/stop", port, {
      "Host": `localhost:${port}`,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(res.status).toBe(204);
    expect(received).toEqual(["/event/stop"]);
  });

  it("GET /health with Origin header returns 403", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    const res = await requestWithHeaders("GET", "/health", listener.port(), {
      "Origin": "http://attacker.example",
    });
    expect(res.status).toBe(403);
  });
});

describe("HttpListener — onEvent body forwarding", () => {
  let receivedBodies: (import("../src/parse-hook-body.js").ParsedBody | undefined)[];

  beforeEach(() => {
    receivedBodies = [];
  });

  it("passes the parsed body as second argument to onEvent when body is valid JSON", async () => {
    listener = new HttpListener({
      port: 0,
      onEvent: (_route, body) => receivedBodies.push(body),
    });
    await listener.start();
    const body = JSON.stringify({ session_id: "abc123def456", cwd: "/home/user/project", source: "compact" });
    await requestWithBody("POST", "/event/session-start", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    expect(receivedBodies).toHaveLength(1);
    expect(receivedBodies[0]).toEqual({
      sessionId: "abc123def456",
      cwd: "/home/user/project",
      message: undefined,
      source: "compact",
    });
  });

  it("passes undefined as second argument to onEvent when body is empty", async () => {
    listener = new HttpListener({
      port: 0,
      onEvent: (_route, body) => receivedBodies.push(body),
    });
    await listener.start();
    await request("POST", "/event/stop", listener.port());
    await new Promise((r) => setTimeout(r, 20));
    expect(receivedBodies).toHaveLength(1);
    expect(receivedBodies[0]).toBeUndefined();
  });

  it("passes undefined as second argument when body is unparseable", async () => {
    listener = new HttpListener({
      port: 0,
      onEvent: (_route, body) => receivedBodies.push(body),
    });
    await listener.start();
    await requestWithBody("POST", "/event/stop", listener.port(), "not-json");
    await new Promise((r) => setTimeout(r, 20));
    expect(receivedBodies).toHaveLength(1);
    expect(receivedBodies[0]).toBeUndefined();
  });

  it("existing route-only onEvent callbacks still compile and work (existing tests unaffected)", async () => {
    // This test demonstrates that the new signature is backward compatible —
    // a callback that ignores the second arg still satisfies the widened type.
    listener = new HttpListener({
      port: 0,
      onEvent: (route) => received.push(route),
    });
    await listener.start();
    await request("POST", "/event/stop", listener.port());
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual(["/event/stop"]);
  });

  it("logs source= in the INFO result line when source is present in the parsed body", async () => {
    listener = new HttpListener({
      port: 0,
      onEvent: () => { /* no-op */ },
      log: makeLog(),
    });
    await listener.start();
    const body = JSON.stringify({ session_id: "a1b2c3d4e5f6", cwd: "/home/user/proj", source: "compact" });
    await requestWithBody("POST", "/event/session-start", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const info = logs.find((l) => l.level === "info" && l.msg.includes("route="));
    expect(info?.msg).toContain("source=compact");
  });

  it("does not append source= in the log line when source is absent from the body", async () => {
    listener = new HttpListener({
      port: 0,
      onEvent: () => { /* no-op */ },
      log: makeLog(),
    });
    await listener.start();
    const body = JSON.stringify({ session_id: "a1b2c3d4e5f6", cwd: "/home/user/proj" });
    await requestWithBody("POST", "/event/session-start", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const info = logs.find((l) => l.level === "info" && l.msg.includes("route="));
    expect(info?.msg).not.toContain("source=");
  });

  it("appends agent= suffix (8-char truncation) when agent_id is present in the parsed body", async () => {
    listener = new HttpListener({
      port: 0,
      onEvent: () => { /* no-op */ },
      log: makeLog(),
    });
    await listener.start();
    const body = JSON.stringify({ session_id: "a1b2c3d4e5f6", cwd: "/home/user/proj", agent_id: "agt-001-xyz-full" });
    await requestWithBody("POST", "/event/stop", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const info = logs.find((l) => l.level === "info" && l.msg.includes("route="));
    expect(info?.msg).toContain("agent=agt-001-");
    expect(info?.msg).not.toContain("agent=agt-001-x"); // truncated to exactly 8 chars
  });

  it("does not append agent= in the log line when agent_id is absent from the body", async () => {
    listener = new HttpListener({
      port: 0,
      onEvent: () => { /* no-op */ },
      log: makeLog(),
    });
    await listener.start();
    const body = JSON.stringify({ session_id: "a1b2c3d4e5f6", cwd: "/home/user/proj" });
    await requestWithBody("POST", "/event/stop", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const info = logs.find((l) => l.level === "info" && l.msg.includes("route="));
    expect(info?.msg).not.toContain("agent=");
  });
});

describe("HttpListener — session-id warn on action routes", () => {
  it("POST with parsed body but no session_id on an action route emits WARN with (session_id required)", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    // Valid JSON, but no session_id field at all.
    const body = JSON.stringify({ cwd: "/home/user/project" });
    await requestWithBody("POST", "/event/stop", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const warn = logs.find((l) => l.level === "warn" && l.msg.includes("session_id"));
    expect(warn).toBeDefined();
    expect(warn?.msg).toMatch(/POST without session_id route=\/event\/stop/);
    expect(warn?.msg).toContain("(session_id required)");
  });

  it("POST with parsed body and session_id='' on an action route emits WARN (empty string is falsy)", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    const body = JSON.stringify({ session_id: "", cwd: "/home/user/project" });
    await requestWithBody("POST", "/event/stop", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const warn = logs.find((l) => l.level === "warn" && l.msg.includes("session_id"));
    expect(warn).toBeDefined();
    expect(warn?.msg).toMatch(/POST without session_id route=\/event\/stop/);
  });

  it("POST with valid non-empty session_id on an action route does NOT emit session-id WARN", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    const body = JSON.stringify({ session_id: "abc123", cwd: "/home/user/project" });
    await requestWithBody("POST", "/event/stop", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const sessionWarn = logs.find((l) => l.level === "warn" && l.msg.includes("session_id"));
    expect(sessionWarn).toBeUndefined();
  });

  it("POST with parsed body but no session_id on an INFO route does NOT emit session-id WARN", async () => {
    listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e), log: makeLog() });
    await listener.start();
    // Info routes are never gated — no session-id warn for them.
    const body = JSON.stringify({ cwd: "/home/user/project" });
    await requestWithBody("POST", "/event/notification", listener.port(), body);
    await new Promise((r) => setTimeout(r, 20));
    const sessionWarn = logs.find((l) => l.level === "warn" && l.msg.includes("session_id"));
    expect(sessionWarn).toBeUndefined();
  });
});

describe("HttpListener — warn suffix on info routes", () => {
  it("POST with empty body on an info route emits WARN without '(session_id required)' suffix", async () => {
    listener = new HttpListener({ port: 0, onEvent: () => { /* no-op */ }, log: makeLog() });
    await listener.start();
    await request("POST", "/event/notification", listener.port());
    await new Promise((r) => setTimeout(r, 20));
    const warn = logs.find((l) => l.level === "warn" && l.msg.includes("empty body"));
    expect(warn).toBeDefined();
    expect(warn!.msg).not.toContain("(session_id required)");
    expect(warn!.msg).toContain("(no usable body)");
  });

  it("POST with unparseable body on an info route emits WARN without '(session_id required)' suffix", async () => {
    listener = new HttpListener({ port: 0, onEvent: () => { /* no-op */ }, log: makeLog() });
    await listener.start();
    await requestWithBody("POST", "/event/notification", listener.port(), "not-json");
    await new Promise((r) => setTimeout(r, 20));
    const warn = logs.find((l) => l.level === "warn" && l.msg.includes("unparseable body"));
    expect(warn).toBeDefined();
    expect(warn!.msg).not.toContain("(session_id required)");
    expect(warn!.msg).toContain("(no usable body)");
  });

  it("POST with oversize body on an info route emits WARN without '(session_id required)' suffix", async () => {
    listener = new HttpListener({ port: 0, onEvent: () => { /* no-op */ }, log: makeLog() });
    await listener.start();
    const big = "{" + '"a":"' + "x".repeat(65 * 1024) + '"}';
    await requestWithBody("POST", "/event/notification", listener.port(), big);
    await new Promise((r) => setTimeout(r, 20));
    const warn = logs.find((l) => l.level === "warn" && l.msg.includes("oversize body"));
    expect(warn).toBeDefined();
    expect(warn!.msg).not.toContain("(session_id required)");
    expect(warn!.msg).toContain("(no usable body)");
  });

  it("POST with empty body on an action route still emits WARN with '(session_id required)' suffix", async () => {
    listener = new HttpListener({ port: 0, onEvent: () => { /* no-op */ }, log: makeLog() });
    await listener.start();
    await request("POST", "/event/stop", listener.port());
    await new Promise((r) => setTimeout(r, 20));
    const warn = logs.find((l) => l.level === "warn" && l.msg.includes("empty body"));
    expect(warn).toBeDefined();
    expect(warn!.msg).toContain("(session_id required)");
    expect(warn!.msg).not.toContain("(no usable body)");
  });
});

describe("HttpListener — connection-lifetime timeouts", () => {
  // Helper: open a raw TCP socket to the listener port and return it.
  // The caller controls what (if anything) is written.
  const openedSockets: net.Socket[] = [];
  function openRawSocket(port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: "127.0.0.1", port });
      openedSockets.push(sock);
      sock.once("connect", () => resolve(sock));
      sock.once("error", reject);
    });
  }

  afterEach(() => {
    for (const sock of openedSockets.splice(0)) {
      if (!sock.destroyed) sock.destroy();
    }
  });

  it("destroys a completely idle socket after idleTimeoutMs", async () => {
    listener = new HttpListener({
      port: 0,
      onEvent: () => { /* no-op */ },
      idleTimeoutMs: 80,
    });
    await listener.start();
    const port = listener.port();

    const sock = await openRawSocket(port);
    // Send nothing — pure idle connection.
    const t0 = Date.now();
    await new Promise<void>((resolve) => sock.once("close", () => resolve()));
    const elapsed = Date.now() - t0;
    // Should have been destroyed within ~3× the timeout (generous for CI jitter).
    expect(elapsed).toBeGreaterThanOrEqual(60);
    expect(elapsed).toBeLessThan(500);
  });

  it("destroys a socket that sends one byte and then goes idle within idleTimeoutMs", async () => {
    listener = new HttpListener({
      port: 0,
      onEvent: () => { /* no-op */ },
      idleTimeoutMs: 80,
    });
    await listener.start();
    const port = listener.port();

    // Connect, wait ~50 ms (well inside the 80 ms window), then write one byte.
    // The idle timer resets on the received data; the socket should close only
    // after a fresh ~80 ms of silence, so total elapsed since connect must be
    // >= ~130 ms (50 ms wait + most of the fresh window) and < 500 ms.
    const t0 = Date.now();
    const sock = await openRawSocket(port);
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    sock.write("P");
    await new Promise<void>((resolve) => sock.once("close", () => resolve()));
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(100);
    expect(elapsed).toBeLessThan(500);
  });

  it("does NOT destroy a normal fast POST before idleTimeoutMs fires", async () => {
    listener = new HttpListener({
      port: 0,
      onEvent: () => { /* no-op */ },
      idleTimeoutMs: 200,
    });
    await listener.start();
    const port = listener.port();

    const body = JSON.stringify({ session_id: "fast-test" });
    const res = await requestWithBody("POST", "/event/stop", port, body);
    expect(res.status).toBe(204);
  });
});
