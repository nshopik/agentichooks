import http from "node:http";
import type { AddressInfo } from "node:net";

const ACTION_ROUTES = new Set<string>([
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
]);

const INFO_ROUTES = new Set<string>([
  "/event/notification",
  "/event/post-tool-batch",
  "/event/subagent-start",
  "/event/subagent-stop",
]);

export type HttpListenerOpts = {
  port: number;
  // Called for every action route; the URL path is forwarded to the dispatcher's
  // matrix lookup. Info routes log + 204 only and never invoke this callback.
  onEvent: (route: string) => void;
  log?: (msg: string) => void;
};

export class HttpListener {
  private opts: HttpListenerOpts;
  private server?: http.Server;

  constructor(opts: HttpListenerOpts) {
    this.opts = opts;
  }

  private log(msg: string): void {
    this.opts.log?.(msg);
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handle(req, res));
      this.server.once("error", reject);
      this.server.listen(this.opts.port, "127.0.0.1", () => resolve());
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

  isListening(): boolean {
    return this.server?.listening ?? false;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? "";
    const peer = req.socket.remoteAddress ?? "?";
    this.log(`${req.method ?? "?"} ${url} from=${peer}`);
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }
    const isAction = ACTION_ROUTES.has(url);
    const isInfo = INFO_ROUTES.has(url);
    if (isAction || isInfo) {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(204);
        res.end();
        setImmediate(() => {
          if (isAction) {
            this.log(`action route=${url}`);
            this.opts.onEvent(url);
          } else {
            this.log(`info-only route=${url}`);
          }
        });
      });
      return;
    }
    res.writeHead(404);
    res.end();
  }
}
