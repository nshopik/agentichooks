import http from "node:http";
import type { AddressInfo } from "node:net";
import type { EventType } from "./types.js";

const ROUTES: Record<string, EventType> = {
  "/event/stop": "stop",
  "/event/idle": "idle",
  "/event/permission": "permission",
};

export type HttpListenerOpts = {
  port: number;
  onEvent: (event: EventType) => void;
};

export class HttpListener {
  private opts: HttpListenerOpts;
  private server?: http.Server;

  constructor(opts: HttpListenerOpts) {
    this.opts = opts;
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
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
      return;
    }
    if (url in ROUTES) {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(204);
        res.end();
        setImmediate(() => this.opts.onEvent(ROUTES[url]));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  }
}
