import http from "node:http";
import type { AddressInfo } from "node:net";
import { makeBodyBuffer, type BodyOutcome, type ParsedBody } from "./parse-hook-body.js";
import type { Logger } from "./types.js";

export const ACTION_ROUTES = new Set<string>([
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
  "/event/subagent-start",
  "/event/subagent-stop",
]);

export const INFO_ROUTES = new Set<string>([
  "/event/notification",
  "/event/post-tool-batch",
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
]);

// Routes whose result line warrants INFO. Everything else logs at DEBUG.
// WARN diagnostics fire on ALL routes regardless of classification.
const SIGNAL_ROUTES = new Set<string>([
  "/event/stop",
  "/event/stop-failure",
  "/event/permission-request",
  "/event/task-completed",
  "/event/task-created",
  "/event/session-start",
  "/event/session-end",
  "/event/user-prompt-submit",
  "/event/permission-denied",
  "/event/notification",
]);

function basename(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

// Attacker-controlled values (headers, url, notification message) are
// length-capped before interpolation into log lines so a peer on the SSH
// forward cannot bloat the log file.
const LOG_VALUE_MAX = 120;
function truncateForLog(value: string): string {
  if (value.length <= LOG_VALUE_MAX) return value;
  return `${value.slice(0, LOG_VALUE_MAX)}…(+${value.length - LOG_VALUE_MAX} more)`;
}

// Warn-line rate limit: rejected/bad-body diagnostics are attacker-triggerable,
// so cap them per window; one suppression notice marks the cut.
const WARN_WINDOW_MS = 60_000;
const MAX_WARNS_PER_WINDOW = 10;

// Production default for idle-socket timeout.
// Safe with the 2-second client timeout Claude Code hooks use.
const DEFAULT_IDLE_TIMEOUT_MS = 5_000;

export type HttpListenerOpts = {
  port: number;
  // Called for every action route; the URL path and parsed body are forwarded
  // to the dispatcher's matrix lookup. Info routes log + 204 only and never
  // invoke this callback.
  onEvent: (route: string, body?: ParsedBody) => void;
  log?: Logger;
  // Idle-socket timeout (maps to server.timeout). Node auto-destroys the
  // socket when no data has flowed for this duration (server-level
  // socket.setTimeout + the default 'timeout' handler). Primary slowloris
  // defence for connections arriving via ssh -R. Override in tests to use
  // small values (tens of ms) so timeout tests stay fast. Default: 5 000 ms.
  idleTimeoutMs?: number;
  // Clock used by the warn rate limiter. Injectable for deterministic
  // window-rollover tests. Default: Date.now.
  now?: () => number;
};

export class HttpListener {
  private opts: HttpListenerOpts;
  private server?: http.Server;
  private resolvedPort = -1;
  private warnWindowStart = 0;
  private warnCount = 0;

  constructor(opts: HttpListenerOpts) {
    this.opts = opts;
  }

  // All listener warn lines go through here. Emits up to MAX_WARNS_PER_WINDOW
  // per window, then one suppression notice, then drops until the window rolls.
  private warnLimited(msg: string): void {
    const now = (this.opts.now ?? Date.now)();
    if (now - this.warnWindowStart >= WARN_WINDOW_MS) {
      this.warnWindowStart = now;
      this.warnCount = 0;
    }
    this.warnCount++;
    if (this.warnCount <= MAX_WARNS_PER_WINDOW) {
      this.opts.log?.warn(msg);
    } else if (this.warnCount === MAX_WARNS_PER_WINDOW + 1) {
      this.opts.log?.warn(
        `warn rate limit reached (${MAX_WARNS_PER_WINDOW}/${WARN_WINDOW_MS / 1000}s); suppressing further warnings this window`,
      );
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      // server.timeout is the idle-socket timeout. Node auto-destroys the
      // socket after no data flows for the configured duration.
      this.server.timeout = this.opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
      this.server.once("error", reject);
      this.server.listen(this.opts.port, "127.0.0.1", () => {
        const addr = this.server!.address();
        if (addr && typeof addr !== "string") {
          this.resolvedPort = addr.port;
        }
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
  }

  port(): number {
    const addr = this.server?.address();
    if (!addr || typeof addr === "string") return -1;
    return (addr as AddressInfo).port;
  }

  // Bound address, or null before start(). Public mirror of port() so tests
  // can assert the loopback-only bind without poking the private server field.
  host(): string | null {
    const addr = this.server?.address();
    if (!addr || typeof addr === "string") return null;
    return (addr as AddressInfo).address;
  }

  isListening(): boolean {
    return this.server?.listening ?? false;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? "";
    const urlLog = truncateForLog(url);
    const peer = req.socket.remoteAddress ?? "?";
    this.opts.log?.debug(`${req.method ?? "?"} ${urlLog} from=${peer}`);

    if (req.headers.origin) {
      this.warnLimited(`rejected from=${peer} url=${urlLog} reason=origin origin=${truncateForLog(req.headers.origin)}`);
      res.writeHead(403); res.end();
      return;
    }

    const expectedPort = this.resolvedPort;
    const allowedHosts = [`127.0.0.1:${expectedPort}`, `localhost:${expectedPort}`];
    if (!allowedHosts.includes(req.headers.host ?? "")) {
      this.warnLimited(`rejected from=${peer} url=${urlLog} reason=host host=${truncateForLog(req.headers.host ?? "(none)")}`);
      res.writeHead(403); res.end();
      return;
    }

    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }

    const isAction = ACTION_ROUTES.has(url);
    const isInfo = INFO_ROUTES.has(url);
    if (!isAction && !isInfo) { res.writeHead(404); res.end(); return; }
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }

    const buffer = makeBodyBuffer();
    req.on("data", (chunk: Buffer) => buffer.push(chunk));
    req.on("end", () => {
      res.writeHead(204);
      res.end();
      setImmediate(() => {
        const outcome = buffer.finish();
        this.logRequest(url, isAction, outcome);
        if (isAction) this.opts.onEvent(url, outcome.kind === "parsed" ? outcome.body : undefined);
      });
    });
  }

  private logRequest(url: string, isAction: boolean, outcome: BodyOutcome): void {
    const kind = isAction ? "action" : "info-only";
    const isSignal = SIGNAL_ROUTES.has(url);
    const emit = (msg: string) =>
      isSignal ? this.opts.log?.info(msg) : this.opts.log?.debug(msg);

    if (outcome.kind === "empty") {
      const suffix = isAction ? "(session_id required)" : "(no usable body)";
      this.warnLimited(`POST with empty body route=${url} ${suffix}`);
      emit(`${kind} route=${url} session=? cwd=?`);
      return;
    }
    if (outcome.kind === "unparseable") {
      const suffix = isAction ? "(session_id required)" : "(no usable body)";
      this.warnLimited(`POST with unparseable body route=${url} ${suffix}`);
      emit(`${kind} route=${url} session=? cwd=?`);
      return;
    }
    if (outcome.kind === "oversize") {
      const suffix = isAction ? "(session_id required)" : "(no usable body)";
      this.warnLimited(`POST with oversize body route=${url} (>256 KB) ${suffix}`);
      emit(`${kind} route=${url} session=? cwd=?`);
      return;
    }
    // Body parsed successfully.
    const { sessionId, cwd, message, source, agentId } = outcome.body;
    // Warn on action routes where session_id is absent or empty — the gate in
    // deriveRoute will drop this event. Info routes are never gated; no warn.
    if (isAction && !sessionId) {
      this.warnLimited(`POST without session_id route=${url} (session_id required)`);
    }
    const sid = sessionId ? sessionId.slice(0, 8) : "?";
    const cwdShort = cwd ? basename(cwd) : "?";
    const sourceSuffix = source ? ` source=${source}` : "";
    const agentSuffix = agentId ? ` agent=${agentId.slice(0, 8)}` : "";
    emit(`${kind} route=${url} session=${sid} cwd=${cwdShort}${sourceSuffix}${agentSuffix}`);
    if (url === "/event/notification" && message) {
      this.opts.log?.info(`notification message=${JSON.stringify(truncateForLog(message))}`);
    }
  }
}
