# Stream Deck Claude Notify Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Stream Deck plugin (TypeScript on @elgato/streamdeck SDK) that flashes a configurable button — with optional audio cue — on Claude Code hook events (Stop, Notification, PermissionRequest), driven by both local sig files (Windows) and remote HTTP over SSH reverse tunnel (Linux/macOS remotes).

**Architecture:** One Stream Deck action UUID, multiple placeable instances each with its own settings. Two ingest paths (per-event sig files watched via fs.watch, plus a 127.0.0.1:9123 HTTP listener) feed a shared dispatcher that arms button alerts and triggers audio. Audio uses spawned PowerShell SoundPlayer.PlaySync against Windows system WAVs by default. Marketplace-ready manifest from day one.

**Tech Stack:** TypeScript 5+, @elgato/streamdeck SDK (SDKVersion 3), @elgato/cli for build/pack, Rollup for bundling, Vitest for unit tests, sdpi-components for Property Inspector UI, PowerShell for hook installer.

**Reference spec:** `docs/superpowers/specs/2026-05-08-streamdeck-claude-notify-plugin-design.md`

---

## File structure (locked-in decomposition)

```
claudenotify/
├─ src/
│  ├─ types.ts                    # Shared types and default constants
│  ├─ system-sounds.ts            # Default sound paths per event
│  ├─ signal-watcher.ts           # fs.watch wrapper (debounce, mtime-gate, lazy-touch)
│  ├─ http-listener.ts            # 127.0.0.1 HTTP server (3 event routes + /health)
│  ├─ audio-player.ts             # PowerShell SoundPlayer spawn + volume cache
│  ├─ dispatcher.ts               # Shared dispatch(event, source) function
│  ├─ icons.ts                    # Bundled icon loader + base64 cache
│  ├─ actions/flash-action.ts     # FlashAction class (SDK-bound)
│  └─ plugin.ts                   # Entrypoint: wires everything together
├─ tests/
│  ├─ system-sounds.test.ts
│  ├─ signal-watcher.test.ts
│  ├─ http-listener.test.ts
│  ├─ audio-player.test.ts
│  └─ dispatcher.test.ts
├─ com.nshopik.claudenotify.sdPlugin/
│  ├─ manifest.json
│  ├─ bin/                        # rollup output (gitignored)
│  ├─ ui/
│  │  ├─ flash.html               # per-button Property Inspector
│  │  └─ plugin-settings.html     # plugin-global Property Inspector
│  ├─ images/
│  │  ├─ keys/                    # 12 PNG files (6 pairs × @1x + @2x)
│  │  ├─ actions/                 # category.svg, flash.svg
│  │  ├─ plugin-icon.png          # 256×256
│  │  └─ plugin-icon@2x.png       # 512×512
│  └─ previews/
│     └─ main.png                 # marketplace listing preview
├─ install-hooks.ps1              # local Windows hook installer
├─ README.md
├─ package.json
├─ tsconfig.json
├─ rollup.config.mjs
├─ vitest.config.ts
└─ .gitignore
```

---

## Task 1: Project bootstrap

**Files:**
- Create: `package.json`, `tsconfig.json`, `rollup.config.mjs`, `vitest.config.ts`, `.gitignore`

- [ ] **Step 1.1: Write `.gitignore`**

```
node_modules/
com.nshopik.claudenotify.sdPlugin/bin/
*.log
coverage/
dist/
.DS_Store
```

- [ ] **Step 1.2: Write `package.json`**

```json
{
  "name": "claudenotify",
  "version": "1.0.0",
  "description": "Stream Deck plugin that flashes on Claude Code hook events",
  "type": "module",
  "scripts": {
    "build": "rollup -c",
    "dev": "rollup -c -w",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "pack": "streamdeck pack com.nshopik.claudenotify.sdPlugin"
  },
  "dependencies": {
    "@elgato/streamdeck": "^1.0.0"
  },
  "devDependencies": {
    "@elgato/cli": "^1.0.0",
    "@rollup/plugin-commonjs": "^28.0.0",
    "@rollup/plugin-node-resolve": "^15.3.0",
    "@rollup/plugin-typescript": "^12.1.0",
    "@types/node": "^20.16.0",
    "rollup": "^4.24.0",
    "tslib": "^2.8.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 1.3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "sourceMap": true,
    "outDir": "./com.nshopik.claudenotify.sdPlugin/bin",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "com.nshopik.claudenotify.sdPlugin/bin"]
}
```

- [ ] **Step 1.4: Write `rollup.config.mjs`**

```js
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.nshopik.claudenotify.sdPlugin/bin/plugin.js",
    format: "es",
    sourcemap: true,
  },
  external: [],
  plugins: [
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
    typescript({ tsconfig: "./tsconfig.json", sourceMap: true }),
  ],
};
```

- [ ] **Step 1.5: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
  },
});
```

- [ ] **Step 1.6: Install dependencies**

Run: `npm install`
Expected: `added NNN packages`, no errors.

- [ ] **Step 1.7: Verify test runner**

Run: `npm test`
Expected: `No test files found, exiting with code 0` (or `passed: 0`). Vitest treats zero tests as success.

- [ ] **Step 1.8: Commit**

```
git add package.json package-lock.json tsconfig.json rollup.config.mjs vitest.config.ts .gitignore
git commit -m "Bootstrap project: TypeScript, rollup, vitest"
```

---

## Task 2: Manifest.json (marketplace-ready)

**Files:**
- Create: `com.nshopik.claudenotify.sdPlugin/manifest.json`

- [ ] **Step 2.1: Write the manifest**

```json
{
  "Name": "Claude Notify",
  "Version": "1.0.0.0",
  "Author": "Nikolay Shopik",
  "Category": "Claude Notify",
  "CategoryIcon": "images/actions/category",
  "Description": "Flash a Stream Deck button on Claude Code hook events (task complete, idle, permission request). Works for local Claude on Windows and remote Claude over SSH.",
  "URL": "https://github.com/nshopik/claudenotify",
  "Icon": "images/plugin-icon",
  "PropertyInspectorPath": "ui/plugin-settings.html",
  "CodePath": "bin/plugin.js",
  "UUID": "com.nshopik.claudenotify",
  "SDKVersion": 3,
  "Software": {
    "MinimumVersion": "6.9"
  },
  "OS": [
    {
      "Platform": "windows",
      "MinimumVersion": "10"
    }
  ],
  "Nodejs": {
    "Version": "20",
    "Debug": "enabled"
  },
  "Actions": [
    {
      "Name": "Flash",
      "UUID": "com.nshopik.claudenotify.flash",
      "Icon": "images/actions/flash",
      "Tooltip": "Flash on a Claude Code hook event",
      "PropertyInspectorPath": "ui/flash.html",
      "SupportedInMultiActions": false,
      "States": [
        {
          "Image": "images/keys/idle-idle"
        }
      ]
    }
  ]
}
```

- [ ] **Step 2.2: Validate manifest schema**

Run: `npx streamdeck validate com.nshopik.claudenotify.sdPlugin`
Expected: validator may report missing image files (resolved in Task 10) — that's OK. Should NOT report manifest schema errors. If schema errors appear, fix before continuing.

- [ ] **Step 2.3: Commit**

```
git add com.nshopik.claudenotify.sdPlugin/manifest.json
git commit -m "Add marketplace-ready manifest (SDKVersion 3, MinimumVersion 6.9)"
```

---

## Task 3: Core types (src/types.ts)

**Files:**
- Create: `src/types.ts`

- [ ] **Step 3.1: Write types and defaults**

```ts
export type EventType = "stop" | "idle" | "permission";
export type EventSource = "local" | "remote";

export type FlashSettings = {
  eventType: EventType;
  flashMode: "static" | "pulse";
  pulseIntervalMs: number;
  autoTimeoutMs: number;
  idleIconPath?: string;
  alertIconPath?: string;
};

export type AudioConfig = {
  enabled: boolean;
  soundPath?: string;
  volumePercent: number;
  source: "all" | "remote" | "local";
};

export type GlobalSettings = {
  httpPort: number;
  httpEnabled: boolean;
  audio: {
    stop: AudioConfig;
    idle: AudioConfig;
    permission: AudioConfig;
  };
};

export type ButtonState = {
  alerting: boolean;
  pulseTimer?: NodeJS.Timeout;
  timeoutTimer?: NodeJS.Timeout;
  pulseFrame: 0 | 1;
};

export const DEFAULT_FLASH_SETTINGS: FlashSettings = {
  eventType: "idle",
  flashMode: "static",
  pulseIntervalMs: 500,
  autoTimeoutMs: 30000,
};

const baseAudio: Omit<AudioConfig, "volumePercent"> = {
  enabled: true,
  source: "remote",
};

export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  httpPort: 9123,
  httpEnabled: true,
  audio: {
    stop: { ...baseAudio, volumePercent: 80 },
    idle: { ...baseAudio, volumePercent: 80 },
    permission: { ...baseAudio, volumePercent: 90 },
  },
};

export const ALL_EVENT_TYPES: ReadonlyArray<EventType> = ["stop", "idle", "permission"];
```

- [ ] **Step 3.2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3.3: Commit**

```
git add src/types.ts
git commit -m "Add shared types and default settings"
```

---

## Task 4: System sound defaults (src/system-sounds.ts)

**Files:**
- Create: `src/system-sounds.ts`
- Test: `tests/system-sounds.test.ts`

- [ ] **Step 4.1: Write the failing test**

```ts
// tests/system-sounds.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { defaultSoundPath } from "../src/system-sounds.js";

describe("defaultSoundPath", () => {
  let originalSystemRoot: string | undefined;

  beforeEach(() => {
    originalSystemRoot = process.env.SystemRoot;
    process.env.SystemRoot = "C:\\Windows";
  });

  afterEach(() => {
    if (originalSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = originalSystemRoot;
  });

  it("returns Speech On.wav for stop", () => {
    expect(defaultSoundPath("stop")).toBe("C:\\Windows\\Media\\Speech On.wav");
  });

  it("returns Windows Notify System Generic.wav for idle", () => {
    expect(defaultSoundPath("idle")).toBe("C:\\Windows\\Media\\Windows Notify System Generic.wav");
  });

  it("returns Windows Message Nudge.wav for permission", () => {
    expect(defaultSoundPath("permission")).toBe("C:\\Windows\\Media\\Windows Message Nudge.wav");
  });

  it("falls back to C:\\Windows when SystemRoot unset", () => {
    delete process.env.SystemRoot;
    expect(defaultSoundPath("stop")).toBe("C:\\Windows\\Media\\Speech On.wav");
  });
});
```

- [ ] **Step 4.2: Run test, expect fail**

Run: `npm test -- system-sounds`
Expected: FAIL — `Cannot find module '../src/system-sounds.js'`.

- [ ] **Step 4.3: Implement**

```ts
// src/system-sounds.ts
import path from "node:path";
import type { EventType } from "./types.js";

const FILENAMES: Record<EventType, string> = {
  stop: "Speech On.wav",
  idle: "Windows Notify System Generic.wav",
  permission: "Windows Message Nudge.wav",
};

export function defaultSoundPath(event: EventType): string {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  return path.win32.join(root, "Media", FILENAMES[event]);
}
```

- [ ] **Step 4.4: Run test, expect pass**

Run: `npm test -- system-sounds`
Expected: PASS — 4 tests passed.

- [ ] **Step 4.5: Commit**

```
git add src/system-sounds.ts tests/system-sounds.test.ts
git commit -m "Add system-sound default path resolver"
```

---

## Task 5: Signal watcher (src/signal-watcher.ts)

**Files:**
- Create: `src/signal-watcher.ts`
- Test: `tests/signal-watcher.test.ts`

This task uses TDD with one test case at a time. Each red-green cycle is a separate sub-step.

- [ ] **Step 5.1: Test scaffold and shared helpers**

```ts
// tests/signal-watcher.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignalWatcher } from "../src/signal-watcher.js";
import type { EventType } from "../src/types.js";

let tmpDir: string;
let received: Array<{ event: EventType; t: number }>;
let watcher: SignalWatcher | undefined;

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sigw-test-"));
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

beforeEach(() => {
  tmpDir = mkTmp();
  received = [];
});

afterEach(async () => {
  if (watcher) {
    watcher.stop();
    watcher = undefined;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SignalWatcher", () => {
  // tests added in subsequent steps
});
```

- [ ] **Step 5.2: Write test 1 — lazy-touches missing files at start**

Add inside the `describe`:

```ts
it("creates missing sig files at start()", () => {
  watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
  watcher.start();
  expect(fs.existsSync(path.join(tmpDir, "claude-notify-stop.sig"))).toBe(true);
  expect(fs.existsSync(path.join(tmpDir, "claude-notify-idle.sig"))).toBe(true);
  expect(fs.existsSync(path.join(tmpDir, "claude-notify-permission.sig"))).toBe(true);
});
```

- [ ] **Step 5.3: Run, expect fail**

Run: `npm test -- signal-watcher`
Expected: FAIL — `Cannot find module '../src/signal-watcher.js'`.

- [ ] **Step 5.4: Implement minimal — class skeleton + lazy touch**

```ts
// src/signal-watcher.ts
import fs from "node:fs";
import path from "node:path";
import type { EventType } from "./types.js";

const FILES: Record<EventType, string> = {
  stop: "claude-notify-stop.sig",
  idle: "claude-notify-idle.sig",
  permission: "claude-notify-permission.sig",
};

const DEBOUNCE_MS = 50;

export type SignalWatcherOpts = {
  tmpDir: string;
  onSignal: (event: EventType) => void;
};

export class SignalWatcher {
  private opts: SignalWatcherOpts;
  private watchers: fs.FSWatcher[] = [];
  private lastMtimeMs: Record<EventType, number> = { stop: 0, idle: 0, permission: 0 };
  private startupMs = 0;
  private debounceTimers: Record<EventType, NodeJS.Timeout | null> = { stop: null, idle: null, permission: null };

  constructor(opts: SignalWatcherOpts) {
    this.opts = opts;
  }

  start(): void {
    this.startupMs = Date.now();
    for (const event of Object.keys(FILES) as EventType[]) {
      const filePath = path.join(this.opts.tmpDir, FILES[event]);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "");
      }
      const stat = fs.statSync(filePath);
      this.lastMtimeMs[event] = stat.mtimeMs;
    }
  }

  stop(): void {
    for (const w of this.watchers) {
      try { w.close(); } catch {}
    }
    this.watchers = [];
    for (const t of Object.values(this.debounceTimers)) {
      if (t) clearTimeout(t);
    }
  }
}
```

- [ ] **Step 5.5: Run, expect pass for test 1**

Run: `npm test -- signal-watcher`
Expected: PASS — 1 test passed.

- [ ] **Step 5.6: Commit**

```
git add src/signal-watcher.ts tests/signal-watcher.test.ts
git commit -m "SignalWatcher: lazy-touch missing sig files"
```

- [ ] **Step 5.7: Write test 2 — emits onSignal when a sig file changes**

```ts
it("emits onSignal with event type when sig file changes", async () => {
  watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
  watcher.start();
  await sleep(20);
  fs.writeFileSync(path.join(tmpDir, "claude-notify-stop.sig"), new Date().toISOString());
  await sleep(150);
  expect(received.map((r) => r.event)).toEqual(["stop"]);
});
```

- [ ] **Step 5.8: Run, expect fail**

Run: `npm test -- signal-watcher`
Expected: FAIL — `received` is empty.

- [ ] **Step 5.9: Implement — attach fs.watch and emit on change**

Replace the body of `start()` and add a private method. Keep existing fields:

```ts
start(): void {
  this.startupMs = Date.now();
  for (const event of Object.keys(FILES) as EventType[]) {
    const filePath = path.join(this.opts.tmpDir, FILES[event]);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "");
    }
    const stat = fs.statSync(filePath);
    this.lastMtimeMs[event] = stat.mtimeMs;
    const w = fs.watch(filePath, () => this.handleChange(event, filePath));
    this.watchers.push(w);
  }
}

private handleChange(event: EventType, filePath: string): void {
  const existing = this.debounceTimers[event];
  if (existing) clearTimeout(existing);
  this.debounceTimers[event] = setTimeout(() => {
    this.debounceTimers[event] = null;
    let stat: fs.Stats;
    try { stat = fs.statSync(filePath); } catch { return; }
    if (stat.mtimeMs <= this.lastMtimeMs[event]) return;
    this.lastMtimeMs[event] = stat.mtimeMs;
    if (stat.mtimeMs < this.startupMs) return;
    this.opts.onSignal(event);
  }, DEBOUNCE_MS);
}
```

- [ ] **Step 5.10: Run, expect pass**

Run: `npm test -- signal-watcher`
Expected: PASS — 2 tests passed.

- [ ] **Step 5.11: Commit**

```
git add src/signal-watcher.ts tests/signal-watcher.test.ts
git commit -m "SignalWatcher: emit onSignal on file change with debounce + mtime gate"
```

- [ ] **Step 5.12: Write test 3 — debounce coalesces rapid writes**

```ts
it("debounces rapid writes within 50ms to one onSignal", async () => {
  watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
  watcher.start();
  await sleep(20);
  const file = path.join(tmpDir, "claude-notify-idle.sig");
  fs.writeFileSync(file, "1");
  fs.writeFileSync(file, "2");
  fs.writeFileSync(file, "3");
  await sleep(150);
  expect(received.length).toBe(1);
  expect(received[0].event).toBe("idle");
});
```

- [ ] **Step 5.13: Run, expect pass (debounce already implemented)**

Run: `npm test -- signal-watcher`
Expected: PASS — 3 tests passed. (The debounce in `handleChange` should already coalesce these.)

- [ ] **Step 5.14: Write test 4 — stale file is ignored at startup**

```ts
it("ignores sig file that already had a recent write before start()", async () => {
  const file = path.join(tmpDir, "claude-notify-permission.sig");
  fs.writeFileSync(file, "old");
  await sleep(20);
  watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
  watcher.start();
  await sleep(150);
  expect(received.length).toBe(0);
});
```

- [ ] **Step 5.15: Run, expect pass (mtime gate handles this)**

Run: `npm test -- signal-watcher`
Expected: PASS — 4 tests passed. The lastMtimeMs initialized in start() prevents re-emitting on first watch event with the same mtime.

- [ ] **Step 5.16: Write test 5 — all three event types route correctly**

```ts
it("routes each filename to the correct EventType", async () => {
  watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
  watcher.start();
  await sleep(20);
  fs.writeFileSync(path.join(tmpDir, "claude-notify-stop.sig"), "a");
  await sleep(120);
  fs.writeFileSync(path.join(tmpDir, "claude-notify-idle.sig"), "b");
  await sleep(120);
  fs.writeFileSync(path.join(tmpDir, "claude-notify-permission.sig"), "c");
  await sleep(150);
  expect(received.map((r) => r.event)).toEqual(["stop", "idle", "permission"]);
});
```

- [ ] **Step 5.17: Run, expect pass**

Run: `npm test -- signal-watcher`
Expected: PASS — 5 tests passed.

- [ ] **Step 5.18: Commit**

```
git add tests/signal-watcher.test.ts
git commit -m "SignalWatcher: tests for debounce, stale-mtime gate, event routing"
```

---

## Task 6: HTTP listener (src/http-listener.ts)

**Files:**
- Create: `src/http-listener.ts`
- Test: `tests/http-listener.test.ts`

- [ ] **Step 6.1: Test scaffold**

```ts
// tests/http-listener.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { HttpListener } from "../src/http-listener.js";
import type { EventType } from "../src/types.js";

let listener: HttpListener | undefined;
let received: EventType[];

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
  // tests added in subsequent steps
});
```

- [ ] **Step 6.2: Test 1 — POST /event/stop returns 204 and fires onEvent**

```ts
it("POST /event/stop returns 204 and calls onEvent('stop')", async () => {
  listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
  await listener.start();
  const port = listener.port();
  const res = await request("POST", "/event/stop", port);
  expect(res.status).toBe(204);
  expect(received).toEqual(["stop"]);
});
```

- [ ] **Step 6.3: Run, expect fail**

Run: `npm test -- http-listener`
Expected: FAIL — `Cannot find module '../src/http-listener.js'`.

- [ ] **Step 6.4: Implement**

```ts
// src/http-listener.ts
import http from "node:http";
import { AddressInfo } from "node:net";
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
      // Drain body, then 204 + dispatch async
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
```

- [ ] **Step 6.5: Run, expect pass**

Run: `npm test -- http-listener`
Expected: PASS — 1 test passed.

- [ ] **Step 6.6: Commit**

```
git add src/http-listener.ts tests/http-listener.test.ts
git commit -m "HttpListener: POST /event/stop -> 204 + dispatch"
```

- [ ] **Step 6.7: Test 2 — all three event routes**

```ts
it("dispatches each event type from its respective route", async () => {
  listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
  await listener.start();
  const port = listener.port();
  await request("POST", "/event/stop", port);
  await request("POST", "/event/idle", port);
  await request("POST", "/event/permission", port);
  await new Promise((r) => setTimeout(r, 20));
  expect(received).toEqual(["stop", "idle", "permission"]);
});
```

- [ ] **Step 6.8: Run, expect pass**

Run: `npm test -- http-listener`
Expected: PASS — 2 tests.

- [ ] **Step 6.9: Test 3 — /health returns 200 OK**

```ts
it("GET /health returns 200 OK", async () => {
  listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
  await listener.start();
  const res = await request("GET", "/health", listener.port());
  expect(res.status).toBe(200);
  expect(res.body).toBe("OK");
});
```

- [ ] **Step 6.10: Run, expect pass**

Run: `npm test -- http-listener`
Expected: PASS — 3 tests.

- [ ] **Step 6.11: Test 4 — unknown path returns 404**

```ts
it("returns 404 for unknown paths", async () => {
  listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
  await listener.start();
  const res = await request("GET", "/nope", listener.port());
  expect(res.status).toBe(404);
});
```

- [ ] **Step 6.12: Run, expect pass**

Run: `npm test -- http-listener`
Expected: PASS — 4 tests.

- [ ] **Step 6.13: Test 5 — GET on event route returns 405**

```ts
it("returns 405 for GET on POST-only event routes", async () => {
  listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
  await listener.start();
  const res = await request("GET", "/event/stop", listener.port());
  expect(res.status).toBe(405);
  expect(received).toEqual([]);
});
```

- [ ] **Step 6.14: Run, expect pass**

Run: `npm test -- http-listener`
Expected: PASS — 5 tests.

- [ ] **Step 6.15: Test 6 — binds 127.0.0.1 only**

```ts
it("binds to 127.0.0.1 only", async () => {
  listener = new HttpListener({ port: 0, onEvent: (e) => received.push(e) });
  await listener.start();
  const addr = (listener as any).server.address();
  expect(addr.address).toBe("127.0.0.1");
});
```

- [ ] **Step 6.16: Run, expect pass**

Run: `npm test -- http-listener`
Expected: PASS — 6 tests.

- [ ] **Step 6.17: Commit**

```
git add tests/http-listener.test.ts
git commit -m "HttpListener: tests for all routes, methods, and bind address"
```

---

## Task 7: Audio player (src/audio-player.ts)

**Files:**
- Create: `src/audio-player.ts`
- Test: `tests/audio-player.test.ts`

The audio player uses dependency injection for `spawn` so tests don't actually invoke PowerShell.

- [ ] **Step 7.1: Test scaffold**

```ts
// tests/audio-player.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AudioPlayer } from "../src/audio-player.js";

type SpawnCall = { cmd: string; args: string[] };
let spawnCalls: SpawnCall[];
let cacheDir: string;

function fakeSpawn(cmd: string, args: string[]): any {
  spawnCalls.push({ cmd, args });
  return { unref() {} };
}

function writeMinimalWav(filePath: string): void {
  const sampleRate = 22050;
  const numSamples = 1024;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);          // fmt chunk size
  buf.writeUInt16LE(1, 20);           // PCM
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(10000, 44 + i * 2);
  }
  fs.writeFileSync(filePath, buf);
}

beforeEach(() => {
  spawnCalls = [];
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
});

afterEach(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

describe("AudioPlayer", () => {
  // tests added below
});
```

- [ ] **Step 7.2: Test 1 — missing file: no spawn, warning logged**

```ts
it("does not spawn when file is missing", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const player = new AudioPlayer({ spawn: fakeSpawn as any, cacheDir });
  player.play("C:\\nope\\nothing.wav", 100);
  expect(spawnCalls.length).toBe(0);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});
```

- [ ] **Step 7.3: Run, expect fail**

Run: `npm test -- audio-player`
Expected: FAIL — `Cannot find module '../src/audio-player.js'`.

- [ ] **Step 7.4: Implement minimal**

```ts
// src/audio-player.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cp from "node:child_process";

export type SpawnFn = (command: string, args: ReadonlyArray<string>, opts: cp.SpawnOptions) => { unref(): void };

export type AudioPlayerOpts = {
  spawn?: SpawnFn;
  cacheDir?: string;
};

export class AudioPlayer {
  private spawn: SpawnFn;
  private cacheDir: string;
  private warnedMissing = new Set<string>();

  constructor(opts: AudioPlayerOpts = {}) {
    this.spawn = opts.spawn ?? ((cmd, args, o) => cp.spawn(cmd, args as string[], o) as any);
    this.cacheDir = opts.cacheDir ?? path.join(process.env.TEMP ?? process.env.TMPDIR ?? ".", "claude-notify-cache");
  }

  play(wavPath: string, volumePercent: number): void {
    if (!fs.existsSync(wavPath)) {
      const key = `${wavPath}|${volumePercent}`;
      if (!this.warnedMissing.has(key)) {
        this.warnedMissing.add(key);
        console.warn(`[claude-notify] audio: file missing: ${wavPath}`);
      }
      return;
    }
    const playPath = volumePercent === 100 ? wavPath : this.ensureVolumeAdjusted(wavPath, volumePercent);
    if (!playPath) return;
    const escaped = playPath.replace(/'/g, "''");
    const psCommand = `(New-Object Media.SoundPlayer '${escaped}').PlaySync()`;
    const child = this.spawn("powershell", ["-NoProfile", "-Command", psCommand], { detached: true, stdio: "ignore" });
    child.unref();
  }

  private ensureVolumeAdjusted(wavPath: string, volumePercent: number): string | null {
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
    const hash = crypto.createHash("sha1").update(wavPath).digest("hex").slice(0, 16);
    const cachePath = path.join(this.cacheDir, `${hash}-${volumePercent}.wav`);
    if (fs.existsSync(cachePath)) return cachePath;
    try {
      const src = fs.readFileSync(wavPath);
      const adjusted = adjustWavVolume(src, volumePercent);
      if (!adjusted) return null;
      fs.writeFileSync(cachePath, adjusted);
      return cachePath;
    } catch (e) {
      console.warn(`[claude-notify] audio: failed to adjust volume for ${wavPath}: ${e}`);
      return null;
    }
  }
}

function adjustWavVolume(buf: Buffer, volumePercent: number): Buffer | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    console.warn("[claude-notify] audio: not a WAV file");
    return null;
  }
  const bitsPerSample = buf.readUInt16LE(34);
  if (bitsPerSample !== 16) {
    console.warn(`[claude-notify] audio: only 16-bit PCM WAV supported (got ${bitsPerSample}-bit)`);
    return null;
  }
  // Locate "data" chunk
  let offset = 12;
  while (offset < buf.length - 8) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "data") {
      offset += 8;
      const out = Buffer.from(buf);
      const factor = volumePercent / 100;
      for (let i = offset; i < offset + size && i + 1 < out.length; i += 2) {
        const s = out.readInt16LE(i);
        const adjusted = Math.max(-32768, Math.min(32767, Math.round(s * factor)));
        out.writeInt16LE(adjusted, i);
      }
      return out;
    }
    offset += 8 + size;
  }
  return null;
}
```

- [ ] **Step 7.5: Run, expect pass**

Run: `npm test -- audio-player`
Expected: PASS — 1 test.

- [ ] **Step 7.6: Commit**

```
git add src/audio-player.ts tests/audio-player.test.ts
git commit -m "AudioPlayer: missing-file warn-and-skip"
```

- [ ] **Step 7.7: Test 2 — volume 100 spawns with original path**

```ts
it("at volume 100, spawns with original path", () => {
  const wav = path.join(cacheDir, "src.wav");
  writeMinimalWav(wav);
  const player = new AudioPlayer({ spawn: fakeSpawn as any, cacheDir });
  player.play(wav, 100);
  expect(spawnCalls.length).toBe(1);
  expect(spawnCalls[0].cmd).toBe("powershell");
  expect(spawnCalls[0].args).toEqual([
    "-NoProfile",
    "-Command",
    `(New-Object Media.SoundPlayer '${wav}').PlaySync()`,
  ]);
});
```

- [ ] **Step 7.8: Run, expect pass**

Run: `npm test -- audio-player`
Expected: PASS — 2 tests.

- [ ] **Step 7.9: Test 3 — volume 80 creates cache and spawns with cache path**

```ts
it("at volume 80, caches a volume-adjusted copy and spawns with cache path", () => {
  const wav = path.join(cacheDir, "src.wav");
  writeMinimalWav(wav);
  const player = new AudioPlayer({ spawn: fakeSpawn as any, cacheDir });
  player.play(wav, 80);
  expect(spawnCalls.length).toBe(1);
  const calledPath = spawnCalls[0].args[2].match(/SoundPlayer '(.+)'/)?.[1];
  expect(calledPath).toBeDefined();
  expect(calledPath).not.toBe(wav);
  expect(fs.existsSync(calledPath!)).toBe(true);
  // cache filename pattern: <16-hex>-80.wav
  expect(path.basename(calledPath!)).toMatch(/^[0-9a-f]{16}-80\.wav$/);
});
```

- [ ] **Step 7.10: Run, expect pass**

Run: `npm test -- audio-player`
Expected: PASS — 3 tests.

- [ ] **Step 7.11: Test 4 — volume 80 reuses existing cache**

```ts
it("at volume 80 with existing cache, does not re-encode", () => {
  const wav = path.join(cacheDir, "src.wav");
  writeMinimalWav(wav);
  const player = new AudioPlayer({ spawn: fakeSpawn as any, cacheDir });
  player.play(wav, 80);
  const firstCachePath = spawnCalls[0].args[2].match(/SoundPlayer '(.+)'/)?.[1]!;
  const firstMtime = fs.statSync(firstCachePath).mtimeMs;
  spawnCalls = [];
  player.play(wav, 80);
  const secondCachePath = spawnCalls[0].args[2].match(/SoundPlayer '(.+)'/)?.[1]!;
  expect(secondCachePath).toBe(firstCachePath);
  expect(fs.statSync(secondCachePath).mtimeMs).toBe(firstMtime);
});
```

- [ ] **Step 7.12: Run, expect pass**

Run: `npm test -- audio-player`
Expected: PASS — 4 tests.

- [ ] **Step 7.13: Test 5 — single quotes in path are doubled**

```ts
it("escapes single quotes in path by doubling", () => {
  const wavName = "with's quote.wav";
  const wav = path.join(cacheDir, wavName);
  writeMinimalWav(wav);
  const player = new AudioPlayer({ spawn: fakeSpawn as any, cacheDir });
  player.play(wav, 100);
  expect(spawnCalls[0].args[2]).toContain(wav.replace(/'/g, "''"));
  expect(spawnCalls[0].args[2]).not.toContain(`'${wav}'`);
});
```

- [ ] **Step 7.14: Run, expect pass**

Run: `npm test -- audio-player`
Expected: PASS — 5 tests.

- [ ] **Step 7.15: Test 6 — non-16-bit WAV is skipped**

```ts
it("skips non-16-bit WAVs with a warning", () => {
  // Build an 8-bit WAV
  const wav = path.join(cacheDir, "8bit.wav");
  const dataSize = 100;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(22050, 24);
  buf.writeUInt32LE(22050, 28);
  buf.writeUInt16LE(1, 32);
  buf.writeUInt16LE(8, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(wav, buf);

  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const player = new AudioPlayer({ spawn: fakeSpawn as any, cacheDir });
  player.play(wav, 80);
  expect(spawnCalls.length).toBe(0);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
```

- [ ] **Step 7.16: Run, expect pass**

Run: `npm test -- audio-player`
Expected: PASS — 6 tests.

- [ ] **Step 7.17: Commit**

```
git add tests/audio-player.test.ts src/audio-player.ts
git commit -m "AudioPlayer: volume cache, single-quote escape, format gate"
```

---

## Task 8: Dispatcher (src/dispatcher.ts)

**Files:**
- Create: `src/dispatcher.ts`
- Test: `tests/dispatcher.test.ts`

- [ ] **Step 8.1: Test scaffold**

```ts
// tests/dispatcher.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Dispatcher } from "../src/dispatcher.js";
import {
  DEFAULT_GLOBAL_SETTINGS,
  DEFAULT_FLASH_SETTINGS,
  type ButtonState,
  type FlashSettings,
  type GlobalSettings,
} from "../src/types.js";

type FakeButton = {
  settings: FlashSettings;
  state: ButtonState;
  alert: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
};

function makeButton(eventType: FlashSettings["eventType"], alerting = false): FakeButton {
  return {
    settings: { ...DEFAULT_FLASH_SETTINGS, eventType },
    state: { alerting, pulseFrame: 0 },
    alert: vi.fn(),
    dismiss: vi.fn(),
  };
}

let audioPlayer: { play: ReturnType<typeof vi.fn> };
let buttons: Map<string, FakeButton>;
let globals: GlobalSettings;

beforeEach(() => {
  audioPlayer = { play: vi.fn() };
  buttons = new Map();
  globals = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS));
});

function dispatcher() {
  return new Dispatcher({
    audioPlayer: audioPlayer as any,
    getGlobalSettings: () => globals,
    getButtons: () => buttons as any,
  });
}

describe("Dispatcher", () => {
  // tests below
});
```

- [ ] **Step 8.2: Test 1 — dispatch with no matching buttons does nothing**

```ts
it("does nothing when no button matches the event type", () => {
  buttons.set("a", makeButton("idle"));
  dispatcher().dispatch("stop", "remote");
  expect(buttons.get("a")!.alert).not.toHaveBeenCalled();
  expect(buttons.get("a")!.dismiss).not.toHaveBeenCalled();
});
```

- [ ] **Step 8.3: Run, expect fail**

Run: `npm test -- dispatcher`
Expected: FAIL — `Cannot find module '../src/dispatcher.js'`.

- [ ] **Step 8.4: Implement minimal**

```ts
// src/dispatcher.ts
import type { EventType, EventSource, GlobalSettings, FlashSettings, ButtonState } from "./types.js";
import { defaultSoundPath } from "./system-sounds.js";

export type DispatchableButton = {
  settings: FlashSettings;
  state: ButtonState;
  alert: () => void;
  dismiss: () => void;
};

export type DispatcherOpts = {
  audioPlayer: { play: (path: string, volumePercent: number) => void };
  getGlobalSettings: () => GlobalSettings;
  getButtons: () => Map<string, DispatchableButton>;
};

export class Dispatcher {
  private opts: DispatcherOpts;

  constructor(opts: DispatcherOpts) {
    this.opts = opts;
  }

  dispatch(event: EventType, source: EventSource): void {
    const buttons = this.opts.getButtons();
    // 1. Dismiss prior alerts
    for (const [, btn] of buttons) {
      if (btn.state.alerting) btn.dismiss();
    }
    // 2. Arm matching
    for (const [, btn] of buttons) {
      if (btn.settings.eventType === event) btn.alert();
    }
    // 3. Audio
    const audioCfg = this.opts.getGlobalSettings().audio[event];
    if (!audioCfg.enabled) return;
    if (audioCfg.source !== "all" && audioCfg.source !== source) return;
    const path = audioCfg.soundPath ?? defaultSoundPath(event);
    this.opts.audioPlayer.play(path, audioCfg.volumePercent);
  }
}
```

- [ ] **Step 8.5: Run, expect pass**

Run: `npm test -- dispatcher`
Expected: PASS — 1 test.

- [ ] **Step 8.6: Commit**

```
git add src/dispatcher.ts tests/dispatcher.test.ts
git commit -m "Dispatcher: dismiss prior + arm matching + audio gate"
```

- [ ] **Step 8.7: Test 2 — matching button gets alert()**

```ts
it("calls alert() on buttons whose eventType matches", () => {
  buttons.set("a", makeButton("stop"));
  buttons.set("b", makeButton("idle"));
  buttons.set("c", makeButton("stop"));
  dispatcher().dispatch("stop", "remote");
  expect(buttons.get("a")!.alert).toHaveBeenCalledTimes(1);
  expect(buttons.get("b")!.alert).not.toHaveBeenCalled();
  expect(buttons.get("c")!.alert).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 8.8: Run, expect pass**

Run: `npm test -- dispatcher`
Expected: PASS — 2 tests.

- [ ] **Step 8.9: Test 3 — dismisses all alerting before arming**

```ts
it("dismisses every alerting button before arming new ones", () => {
  buttons.set("a", makeButton("stop", true));      // currently alerting
  buttons.set("b", makeButton("permission", true)); // currently alerting
  buttons.set("c", makeButton("idle"));             // target
  dispatcher().dispatch("idle", "remote");
  expect(buttons.get("a")!.dismiss).toHaveBeenCalledTimes(1);
  expect(buttons.get("b")!.dismiss).toHaveBeenCalledTimes(1);
  expect(buttons.get("c")!.alert).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 8.10: Run, expect pass**

Run: `npm test -- dispatcher`
Expected: PASS — 3 tests.

- [ ] **Step 8.11: Test 4 — audio plays when source matches filter**

```ts
it("plays audio for matching source filter", () => {
  globals.audio.stop.source = "remote";
  globals.audio.stop.volumePercent = 75;
  buttons.set("a", makeButton("stop"));
  dispatcher().dispatch("stop", "remote");
  expect(audioPlayer.play).toHaveBeenCalledTimes(1);
  expect(audioPlayer.play).toHaveBeenCalledWith(expect.stringContaining("Speech On.wav"), 75);
});
```

- [ ] **Step 8.12: Run, expect pass**

Run: `npm test -- dispatcher`
Expected: PASS — 4 tests.

- [ ] **Step 8.13: Test 5 — audio skipped when source filter doesn't match**

```ts
it("skips audio when source filter is 'remote' but event source is 'local'", () => {
  globals.audio.stop.source = "remote";
  buttons.set("a", makeButton("stop"));
  dispatcher().dispatch("stop", "local");
  expect(audioPlayer.play).not.toHaveBeenCalled();
});

it("skips audio when audio.enabled is false", () => {
  globals.audio.stop.enabled = false;
  globals.audio.stop.source = "all";
  buttons.set("a", makeButton("stop"));
  dispatcher().dispatch("stop", "remote");
  expect(audioPlayer.play).not.toHaveBeenCalled();
});

it("plays audio with source 'all' regardless of event source", () => {
  globals.audio.idle.source = "all";
  buttons.set("a", makeButton("idle"));
  dispatcher().dispatch("idle", "local");
  expect(audioPlayer.play).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 8.14: Run, expect pass**

Run: `npm test -- dispatcher`
Expected: PASS — 7 tests.

- [ ] **Step 8.15: Test 6 — custom soundPath overrides default**

```ts
it("uses configured soundPath when set", () => {
  globals.audio.permission.soundPath = "C:\\custom\\alert.wav";
  globals.audio.permission.source = "all";
  buttons.set("a", makeButton("permission"));
  dispatcher().dispatch("permission", "local");
  expect(audioPlayer.play).toHaveBeenCalledWith("C:\\custom\\alert.wav", expect.any(Number));
});
```

- [ ] **Step 8.16: Run, expect pass**

Run: `npm test -- dispatcher`
Expected: PASS — 8 tests.

- [ ] **Step 8.17: Commit**

```
git add tests/dispatcher.test.ts
git commit -m "Dispatcher: audio source filtering + soundPath override tests"
```

---

## Task 9: FlashAction class (src/actions/flash-action.ts)

**Files:**
- Create: `src/actions/flash-action.ts`, `src/icons.ts`

The FlashAction is SDK-coupled and tested manually. We define its public surface so the dispatcher can drive it via the buttons map.

- [ ] **Step 9.1: Write `src/icons.ts`**

```ts
// src/icons.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EventType } from "./types.js";

const cache = new Map<string, string>();

function pluginRoot(): string {
  // The bundled plugin.js lives at <plugin>/bin/plugin.js.
  // import.meta.url at runtime points to that built file.
  const here = fileURLToPath(import.meta.url);
  return path.dirname(path.dirname(here)); // up from bin/ to plugin root
}

export function keyIconBase64(event: EventType, kind: "idle" | "alert"): string {
  const key = `${event}-${kind}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const filePath = path.join(pluginRoot(), "images", "keys", `${key}.png`);
  const buf = fs.readFileSync(filePath);
  const dataUri = `data:image/png;base64,${buf.toString("base64")}`;
  cache.set(key, dataUri);
  return dataUri;
}

export function readImageAsDataUri(absPath: string): string {
  const cached = cache.get(absPath);
  if (cached) return cached;
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".svg" ? "image/svg+xml" : "image/png";
  const buf = fs.readFileSync(absPath);
  const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
  cache.set(absPath, dataUri);
  return dataUri;
}
```

- [ ] **Step 9.2: Write `src/actions/flash-action.ts`**

```ts
// src/actions/flash-action.ts
import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type KeyDownEvent,
  type DidReceiveSettingsEvent,
  type SendToPluginEvent,
} from "@elgato/streamdeck";
import { DEFAULT_FLASH_SETTINGS, type FlashSettings, type ButtonState } from "../types.js";
import { keyIconBase64, readImageAsDataUri } from "../icons.js";

type Ctx = {
  context: string;
  settings: FlashSettings;
  state: ButtonState;
  setImage: (b64: string) => Promise<void>;
};

@action({ UUID: "com.nshopik.claudenotify.flash" })
export class FlashAction extends SingletonAction<FlashSettings> {
  private readonly contexts = new Map<string, Ctx>();

  buttonsForDispatcher(): Map<string, { settings: FlashSettings; state: ButtonState; alert: () => void; dismiss: () => void }> {
    const out = new Map();
    for (const [k, v] of this.contexts) {
      out.set(k, {
        settings: v.settings,
        state: v.state,
        alert: () => this.alertContext(v),
        dismiss: () => this.dismissContext(v),
      });
    }
    return out;
  }

  override async onWillAppear(ev: WillAppearEvent<FlashSettings>): Promise<void> {
    const settings = { ...DEFAULT_FLASH_SETTINGS, ...(ev.payload.settings ?? {}) };
    const ctx: Ctx = {
      context: ev.action.id,
      settings,
      state: { alerting: false, pulseFrame: 0 },
      setImage: (b64) => ev.action.setImage(b64) as Promise<void>,
    };
    this.contexts.set(ev.action.id, ctx);
    await ctx.setImage(this.idleIcon(ctx));
  }

  override async onWillDisappear(ev: WillDisappearEvent<FlashSettings>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (ctx) this.clearTimers(ctx);
    this.contexts.delete(ev.action.id);
  }

  override async onKeyDown(ev: KeyDownEvent<FlashSettings>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    if (ctx.state.alerting) this.dismissContext(ctx);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<FlashSettings>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    ctx.settings = { ...DEFAULT_FLASH_SETTINGS, ...(ev.payload.settings ?? {}) };
    if (!ctx.state.alerting) await ctx.setImage(this.idleIcon(ctx));
  }

  override async onSendToPlugin(ev: SendToPluginEvent<any, FlashSettings>): Promise<void> {
    const ctx = this.contexts.get(ev.action.id);
    if (!ctx) return;
    if ((ev.payload as any)?.kind === "test-flash") {
      this.alertContext(ctx);
    }
  }

  private alertContext(ctx: Ctx): void {
    this.clearTimers(ctx);
    ctx.state.alerting = true;
    ctx.state.pulseFrame = 1;
    void ctx.setImage(this.alertIcon(ctx));
    if (ctx.settings.flashMode === "pulse") {
      const interval = Math.max(100, ctx.settings.pulseIntervalMs);
      ctx.state.pulseTimer = setInterval(() => {
        ctx.state.pulseFrame = ctx.state.pulseFrame === 1 ? 0 : 1;
        void ctx.setImage(ctx.state.pulseFrame === 1 ? this.alertIcon(ctx) : this.idleIcon(ctx));
      }, interval);
    }
    if (ctx.settings.autoTimeoutMs > 0) {
      ctx.state.timeoutTimer = setTimeout(() => this.dismissContext(ctx), ctx.settings.autoTimeoutMs);
    }
  }

  private dismissContext(ctx: Ctx): void {
    this.clearTimers(ctx);
    ctx.state.alerting = false;
    ctx.state.pulseFrame = 0;
    void ctx.setImage(this.idleIcon(ctx));
  }

  private clearTimers(ctx: Ctx): void {
    if (ctx.state.pulseTimer) { clearInterval(ctx.state.pulseTimer); ctx.state.pulseTimer = undefined; }
    if (ctx.state.timeoutTimer) { clearTimeout(ctx.state.timeoutTimer); ctx.state.timeoutTimer = undefined; }
  }

  private idleIcon(ctx: Ctx): string {
    if (ctx.settings.idleIconPath) {
      try { return readImageAsDataUri(ctx.settings.idleIconPath); } catch { /* fall through */ }
    }
    return keyIconBase64(ctx.settings.eventType, "idle");
  }

  private alertIcon(ctx: Ctx): string {
    if (ctx.settings.alertIconPath) {
      try { return readImageAsDataUri(ctx.settings.alertIconPath); } catch { /* fall through */ }
    }
    return keyIconBase64(ctx.settings.eventType, "alert");
  }
}
```

- [ ] **Step 9.3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (Image files don't exist yet — those land in Task 10. Code references them via path strings, no compile-time check.)

- [ ] **Step 9.4: Commit**

```
git add src/actions/flash-action.ts src/icons.ts
git commit -m "FlashAction: lifecycle + alert/dismiss state machine + sendToPlugin test handler"
```

---

## Task 10: Bundled image assets

**Files:**
- Create: `com.nshopik.claudenotify.sdPlugin/images/{plugin-icon,plugin-icon@2x}.png`
- Create: `com.nshopik.claudenotify.sdPlugin/images/actions/{category,flash}.svg`
- Create: `com.nshopik.claudenotify.sdPlugin/images/keys/{stop,idle,permission}-{idle,alert}.png` (+ `@2x.png` each, 12 PNG files total)
- Create: `com.nshopik.claudenotify.sdPlugin/previews/main.png`

This task generates icons from inline SVG sources using ImageMagick. **Prerequisite**: install ImageMagick (`winget install ImageMagick.ImageMagick`). If unavailable, open the SVGs in any vector editor and export at the listed sizes manually.

- [ ] **Step 10.1: Write `images/actions/category.svg` (28×28 viewport, white on transparent)**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
  <path fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        d="M14 4 L7 16 H13 L11 24 L21 12 H15 Z"/>
</svg>
```

(A simple lightning-bolt outline glyph.)

- [ ] **Step 10.2: Write `images/actions/flash.svg` (20×20 viewport, white on transparent)**

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20">
  <path fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
        d="M10 2 L5 11 H9 L7.5 18 L15 9 H11 Z"/>
</svg>
```

- [ ] **Step 10.3: Write a key-icon SVG generator script — `scripts/gen-key-icons.ps1`**

```powershell
# scripts/gen-key-icons.ps1
# Generates 6 SVG sources for key icons (idle + alert per event type).
$ErrorActionPreference = "Stop"
$out = "com.nshopik.claudenotify.sdPlugin/images/keys"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$events = @{
  stop       = @{ glyph = "M18 36 l12 12 l24 -24"; idleBg = "#1f2937"; alertBg = "#16a34a" }   # check
  idle       = @{ glyph = "M36 18 v18 l12 12";    idleBg = "#1f2937"; alertBg = "#eab308" }   # clock-hand
  permission = @{ glyph = "M30 24 v18 M30 48 v6"; idleBg = "#1f2937"; alertBg = "#dc2626" }   # exclamation
}

function MakeSvg($bg, $glyph) {
  return @"
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 72 72' width='72' height='72'>
  <rect width='72' height='72' rx='10' fill='$bg'/>
  <path d='$glyph' stroke='#FFFFFF' stroke-width='6' fill='none' stroke-linecap='round' stroke-linejoin='round'/>
</svg>
"@
}

foreach ($name in $events.Keys) {
  $cfg = $events[$name]
  Set-Content -Path "$out/$name-idle.svg"  -Value (MakeSvg $cfg.idleBg  $cfg.glyph)
  Set-Content -Path "$out/$name-alert.svg" -Value (MakeSvg $cfg.alertBg $cfg.glyph)
}

# Plugin icon (256x256, dark background with bell glyph)
Set-Content -Path "com.nshopik.claudenotify.sdPlugin/images/plugin-icon.svg" -Value @"
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' width='256' height='256'>
  <rect width='256' height='256' rx='40' fill='#0f172a'/>
  <path d='M128 60 c-30 0 -50 22 -50 60 v32 l-14 18 v8 h128 v-8 l-14 -18 v-32 c0 -38 -20 -60 -50 -60 z M112 188 c0 10 8 18 16 18 s16 -8 16 -18 z'
        fill='#3b82f6'/>
</svg>
"@
Write-Host "Generated SVG sources."
```

Run: `powershell -ExecutionPolicy Bypass -File scripts/gen-key-icons.ps1`
Expected: all 7 SVG files created.

- [ ] **Step 10.4: Rasterize SVGs to PNG at the required sizes**

Write `scripts/rasterize.ps1`:

```powershell
# scripts/rasterize.ps1
$ErrorActionPreference = "Stop"
$keys = "com.nshopik.claudenotify.sdPlugin/images/keys"

# Key icons: 72x72 + 144x144
foreach ($svg in Get-ChildItem $keys -Filter *.svg) {
  $base = [System.IO.Path]::GetFileNameWithoutExtension($svg.Name)
  & magick -background none -density 384 "$keys/$base.svg" -resize 72x72   "$keys/$base.png"
  & magick -background none -density 768 "$keys/$base.svg" -resize 144x144 "$keys/$base@2x.png"
}

# Plugin icon: 256x256 + 512x512
$piSvg = "com.nshopik.claudenotify.sdPlugin/images/plugin-icon.svg"
& magick -background none -density 512  $piSvg -resize 256x256 "com.nshopik.claudenotify.sdPlugin/images/plugin-icon.png"
& magick -background none -density 1024 $piSvg -resize 512x512 "com.nshopik.claudenotify.sdPlugin/images/plugin-icon@2x.png"

# Preview placeholder (800x600 dark with text)
& magick -size 800x600 xc:"#0f172a" -fill white -gravity center -pointsize 40 -annotate +0+0 "Claude Notify" "com.nshopik.claudenotify.sdPlugin/previews/main.png"

Write-Host "Rasterization complete."
```

Create previews dir first: `New-Item -ItemType Directory -Force -Path com.nshopik.claudenotify.sdPlugin/previews | Out-Null`

Run: `powershell -ExecutionPolicy Bypass -File scripts/rasterize.ps1`
Expected: 12 key PNGs + 2 plugin-icon PNGs + 1 preview PNG produced.

- [ ] **Step 10.5: Verify file listing**

Run: `Get-ChildItem com.nshopik.claudenotify.sdPlugin/images -Recurse -File | Select-Object FullName`
Expected output includes:
- `images/plugin-icon.png` and `plugin-icon@2x.png`
- `images/actions/category.svg` and `flash.svg`
- `images/keys/{stop,idle,permission}-{idle,alert}.png` and `@2x.png` (12 files)

- [ ] **Step 10.6: Re-run manifest validator**

Run: `npx streamdeck validate com.nshopik.claudenotify.sdPlugin`
Expected: validation passes (or only warns about Property Inspector files, which land in Task 11/12).

- [ ] **Step 10.7: Commit**

```
git add com.nshopik.claudenotify.sdPlugin/images com.nshopik.claudenotify.sdPlugin/previews scripts
git commit -m "Bundled assets: key icons, action list icons, plugin icon, preview"
```

---

## Task 11: Per-button Property Inspector

**Files:**
- Create: `com.nshopik.claudenotify.sdPlugin/ui/flash.html`

The Property Inspector is plain HTML using Elgato's `sdpi-components` library, served from a CDN. Note for marketplace: vendoring may be required at submission time — leave the CDN reference for development.

- [ ] **Step 11.1: Write `flash.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Claude Notify — Flash</title>
  <script src="https://sdpi-components.dev/releases/v3/sdpi-components.js"></script>
</head>
<body>
  <sdpi-item label="Event type">
    <sdpi-select setting="eventType" default="idle">
      <option value="stop">Stop (task done)</option>
      <option value="idle">Idle / waiting</option>
      <option value="permission">Permission request</option>
    </sdpi-select>
  </sdpi-item>

  <sdpi-item label="Idle icon">
    <sdpi-file setting="idleIconPath" placeholder="(default for chosen event)" accept="image/png,image/jpeg,image/svg+xml"></sdpi-file>
  </sdpi-item>

  <sdpi-item label="Alert icon">
    <sdpi-file setting="alertIconPath" placeholder="(default for chosen event)" accept="image/png,image/jpeg,image/svg+xml"></sdpi-file>
  </sdpi-item>

  <sdpi-item label="Flash mode">
    <sdpi-radio setting="flashMode" default="static">
      <option value="static">Static</option>
      <option value="pulse">Pulse</option>
    </sdpi-radio>
  </sdpi-item>

  <sdpi-item label="Pulse rate (ms)" id="pulse-rate-row">
    <sdpi-range setting="pulseIntervalMs" min="100" max="2000" step="50" default="500" showlabels></sdpi-range>
  </sdpi-item>

  <sdpi-item label="Auto-dismiss (sec)">
    <sdpi-textfield setting="autoTimeoutSeconds" placeholder="30" default="30" pattern="[0-9]+"></sdpi-textfield>
  </sdpi-item>

  <sdpi-item>
    <sdpi-button id="test-flash">Test flash</sdpi-button>
  </sdpi-item>

  <script>
    // Hide pulse rate row when flashMode === "static"
    const updatePulseVisibility = () => {
      const row = document.getElementById("pulse-rate-row");
      const mode = document.querySelector('sdpi-radio[setting="flashMode"]')?.value;
      if (row) row.style.display = mode === "pulse" ? "" : "none";
    };
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(updatePulseVisibility, 50);
      document.querySelector('sdpi-radio[setting="flashMode"]')?.addEventListener("valuechange", updatePulseVisibility);
    });

    // Test button → sendToPlugin
    document.getElementById("test-flash")?.addEventListener("click", () => {
      // sdpi-components exposes the connection via window.SDPIComponents
      window.SDPIComponents?.streamDeckClient?.send("sendToPlugin", { kind: "test-flash" });
    });
  </script>
</body>
</html>
```

- [ ] **Step 11.2: Note autoTimeoutSeconds vs autoTimeoutMs**

The Property Inspector uses seconds for usability; the FlashSettings stores milliseconds. Add a Settings adapter in `flash-action.ts` that converts. Edit `src/actions/flash-action.ts`:

Find the `onDidReceiveSettings` method body and replace it with:

```ts
override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<FlashSettings>): Promise<void> {
  const ctx = this.contexts.get(ev.action.id);
  if (!ctx) return;
  const raw = (ev.payload.settings ?? {}) as Partial<FlashSettings> & { autoTimeoutSeconds?: number | string };
  const seconds = raw.autoTimeoutSeconds !== undefined ? Number(raw.autoTimeoutSeconds) : undefined;
  const merged: FlashSettings = {
    ...DEFAULT_FLASH_SETTINGS,
    ...raw,
    autoTimeoutMs: !isNaN(seconds!) ? seconds! * 1000 : DEFAULT_FLASH_SETTINGS.autoTimeoutMs,
  };
  ctx.settings = merged;
  if (!ctx.state.alerting) await ctx.setImage(this.idleIcon(ctx));
}
```

Apply the same conversion in `onWillAppear` — replace its body:

```ts
override async onWillAppear(ev: WillAppearEvent<FlashSettings>): Promise<void> {
  const raw = (ev.payload.settings ?? {}) as Partial<FlashSettings> & { autoTimeoutSeconds?: number | string };
  const seconds = raw.autoTimeoutSeconds !== undefined ? Number(raw.autoTimeoutSeconds) : undefined;
  const settings: FlashSettings = {
    ...DEFAULT_FLASH_SETTINGS,
    ...raw,
    autoTimeoutMs: !isNaN(seconds!) ? seconds! * 1000 : DEFAULT_FLASH_SETTINGS.autoTimeoutMs,
  };
  const ctx: Ctx = {
    context: ev.action.id,
    settings,
    state: { alerting: false, pulseFrame: 0 },
    setImage: (b64) => ev.action.setImage(b64) as Promise<void>,
  };
  this.contexts.set(ev.action.id, ctx);
  await ctx.setImage(this.idleIcon(ctx));
}
```

- [ ] **Step 11.3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 11.4: Commit**

```
git add com.nshopik.claudenotify.sdPlugin/ui/flash.html src/actions/flash-action.ts
git commit -m "Per-button Property Inspector + seconds-to-ms settings adapter"
```

---

## Task 12: Plugin-global Property Inspector

**Files:**
- Create: `com.nshopik.claudenotify.sdPlugin/ui/plugin-settings.html`

- [ ] **Step 12.1: Write `plugin-settings.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Claude Notify — Plugin settings</title>
  <script src="https://sdpi-components.dev/releases/v3/sdpi-components.js"></script>
</head>
<body>
  <sdpi-heading>Remote hook listener (HTTP)</sdpi-heading>
  <sdpi-item label="Enabled">
    <sdpi-checkbox setting="httpEnabled" default="true" global></sdpi-checkbox>
  </sdpi-item>
  <sdpi-item label="Port">
    <sdpi-textfield setting="httpPort" default="9123" pattern="[0-9]+" global></sdpi-textfield>
  </sdpi-item>
  <sdpi-item label="Test from remote">
    <code>curl -X POST http://localhost:9123/event/stop</code>
  </sdpi-item>

  <sdpi-heading>Audio feedback</sdpi-heading>

  <sdpi-heading style="font-size: 0.9em; margin-top: 12px;">Stop</sdpi-heading>
  <sdpi-item label="Enabled">
    <sdpi-checkbox setting="audio.stop.enabled" default="true" global></sdpi-checkbox>
  </sdpi-item>
  <sdpi-item label="Source">
    <sdpi-select setting="audio.stop.source" default="remote" global>
      <option value="all">All</option>
      <option value="remote">Remote only</option>
      <option value="local">Local only</option>
    </sdpi-select>
  </sdpi-item>
  <sdpi-item label="Sound (WAV)">
    <sdpi-file setting="audio.stop.soundPath" accept="audio/wav,.wav" placeholder="Speech On.wav (system)" global></sdpi-file>
  </sdpi-item>
  <sdpi-item label="Volume %">
    <sdpi-range setting="audio.stop.volumePercent" min="0" max="100" step="5" default="80" showlabels global></sdpi-range>
  </sdpi-item>
  <sdpi-item><sdpi-button class="audio-test" data-event="stop">▶ Test</sdpi-button></sdpi-item>

  <sdpi-heading style="font-size: 0.9em; margin-top: 12px;">Idle</sdpi-heading>
  <sdpi-item label="Enabled">
    <sdpi-checkbox setting="audio.idle.enabled" default="true" global></sdpi-checkbox>
  </sdpi-item>
  <sdpi-item label="Source">
    <sdpi-select setting="audio.idle.source" default="remote" global>
      <option value="all">All</option>
      <option value="remote">Remote only</option>
      <option value="local">Local only</option>
    </sdpi-select>
  </sdpi-item>
  <sdpi-item label="Sound (WAV)">
    <sdpi-file setting="audio.idle.soundPath" accept="audio/wav,.wav" placeholder="Windows Notify System Generic.wav (system)" global></sdpi-file>
  </sdpi-item>
  <sdpi-item label="Volume %">
    <sdpi-range setting="audio.idle.volumePercent" min="0" max="100" step="5" default="80" showlabels global></sdpi-range>
  </sdpi-item>
  <sdpi-item><sdpi-button class="audio-test" data-event="idle">▶ Test</sdpi-button></sdpi-item>

  <sdpi-heading style="font-size: 0.9em; margin-top: 12px;">Permission</sdpi-heading>
  <sdpi-item label="Enabled">
    <sdpi-checkbox setting="audio.permission.enabled" default="true" global></sdpi-checkbox>
  </sdpi-item>
  <sdpi-item label="Source">
    <sdpi-select setting="audio.permission.source" default="remote" global>
      <option value="all">All</option>
      <option value="remote">Remote only</option>
      <option value="local">Local only</option>
    </sdpi-select>
  </sdpi-item>
  <sdpi-item label="Sound (WAV)">
    <sdpi-file setting="audio.permission.soundPath" accept="audio/wav,.wav" placeholder="Windows Message Nudge.wav (system)" global></sdpi-file>
  </sdpi-item>
  <sdpi-item label="Volume %">
    <sdpi-range setting="audio.permission.volumePercent" min="0" max="100" step="5" default="90" showlabels global></sdpi-range>
  </sdpi-item>
  <sdpi-item><sdpi-button class="audio-test" data-event="permission">▶ Test</sdpi-button></sdpi-item>

  <script>
    document.querySelectorAll(".audio-test").forEach((btn) => {
      btn.addEventListener("click", () => {
        const event = btn.getAttribute("data-event");
        window.SDPIComponents?.streamDeckClient?.send("sendToPlugin", { kind: "test-audio", event });
      });
    });
  </script>
</body>
</html>
```

- [ ] **Step 12.2: Commit**

```
git add com.nshopik.claudenotify.sdPlugin/ui/plugin-settings.html
git commit -m "Plugin-global Property Inspector with audio per event"
```

---

## Task 13: plugin.ts entrypoint

**Files:**
- Create: `src/plugin.ts`

- [ ] **Step 13.1: Write the entrypoint**

```ts
// src/plugin.ts
import streamDeck, { LogLevel } from "@elgato/streamdeck";
import { FlashAction } from "./actions/flash-action.js";
import { SignalWatcher } from "./signal-watcher.js";
import { HttpListener } from "./http-listener.js";
import { AudioPlayer } from "./audio-player.js";
import { Dispatcher } from "./dispatcher.js";
import { defaultSoundPath } from "./system-sounds.js";
import { DEFAULT_GLOBAL_SETTINGS, type GlobalSettings, type EventType } from "./types.js";
import os from "node:os";

streamDeck.logger.setLevel(LogLevel.INFO);

const action = new FlashAction();
streamDeck.actions.registerAction(action);

const audioPlayer = new AudioPlayer();

let globals: GlobalSettings = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS));

async function loadGlobals(): Promise<void> {
  const stored = await streamDeck.settings.getGlobalSettings<Partial<GlobalSettings>>();
  globals = mergeGlobals(stored);
}

function mergeGlobals(stored: Partial<GlobalSettings>): GlobalSettings {
  const base = JSON.parse(JSON.stringify(DEFAULT_GLOBAL_SETTINGS)) as GlobalSettings;
  if (!stored) return base;
  if (typeof stored.httpPort === "number") base.httpPort = stored.httpPort;
  if (typeof stored.httpEnabled === "boolean") base.httpEnabled = stored.httpEnabled;
  if (stored.audio) {
    for (const ev of ["stop", "idle", "permission"] as EventType[]) {
      if (stored.audio[ev]) Object.assign(base.audio[ev], stored.audio[ev]);
    }
  }
  return base;
}

streamDeck.settings.onDidReceiveGlobalSettings<Partial<GlobalSettings>>((ev) => {
  globals = mergeGlobals(ev.settings);
});

const dispatcher = new Dispatcher({
  audioPlayer,
  getGlobalSettings: () => globals,
  getButtons: () => action.buttonsForDispatcher(),
});

const watcher = new SignalWatcher({
  tmpDir: os.tmpdir(),
  onSignal: (event) => dispatcher.dispatch(event, "local"),
});

let listener: HttpListener | undefined;

async function startListener(): Promise<void> {
  if (!globals.httpEnabled) return;
  listener = new HttpListener({
    port: globals.httpPort,
    onEvent: (event) => dispatcher.dispatch(event, "remote"),
  });
  try {
    await listener.start();
    streamDeck.logger.info(`HTTP listener bound to 127.0.0.1:${globals.httpPort}`);
  } catch (err) {
    streamDeck.logger.error(`HTTP listener failed to start: ${err}`);
    listener = undefined;
  }
}

// Plugin-global sendToPlugin handler for "test-audio" payload from plugin-settings.html.
// Per-button "test-flash" is handled inside FlashAction.onSendToPlugin.
streamDeck.system.onApplicationDidLaunch(() => { /* placeholder for future hooks */ });

// The SDK does not expose a plugin-level onSendToPlugin in v1; the plugin-settings UI
// payload arrives through streamDeck.ui (UI events). We handle test-audio there.
streamDeck.ui.onSendToPlugin?.((ev: any) => {
  if (ev?.payload?.kind === "test-audio") {
    const event = ev.payload.event as EventType;
    const cfg = globals.audio[event];
    const path = cfg.soundPath ?? defaultSoundPath(event);
    audioPlayer.play(path, cfg.volumePercent);
  }
});

async function shutdown(): Promise<void> {
  watcher.stop();
  if (listener) await listener.stop();
}
process.on("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
process.on("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });

(async () => {
  await streamDeck.connect();
  await loadGlobals();
  watcher.start();
  await startListener();
  streamDeck.logger.info("Claude Notify plugin started");
})();
```

- [ ] **Step 13.2: Build**

Run: `npm run build`
Expected: produces `com.nshopik.claudenotify.sdPlugin/bin/plugin.js` with no errors.

- [ ] **Step 13.3: Commit**

```
git add src/plugin.ts
git commit -m "plugin.ts entrypoint: wire watchers, listener, dispatcher, audio"
```

---

## Task 14: install-hooks.ps1 + README.md

**Files:**
- Create: `install-hooks.ps1`
- Create: `README.md`

- [ ] **Step 14.1: Write `install-hooks.ps1`**

```powershell
# install-hooks.ps1
# Idempotently installs Claude Code hooks that touch the three claude-notify-*.sig files.
# Run with: powershell -ExecutionPolicy Bypass -File install-hooks.ps1

$ErrorActionPreference = "Stop"
$settingsPath = Join-Path $env:USERPROFILE ".claude\settings.json"
$marker = "_claude-notify-installer"

function Read-Settings {
  if (-not (Test-Path $settingsPath)) {
    return [pscustomobject]@{}
  }
  $raw = Get-Content $settingsPath -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) { return [pscustomobject]@{} }
  return $raw | ConvertFrom-Json
}

function Write-Settings($obj) {
  $dir = Split-Path $settingsPath -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $json = $obj | ConvertTo-Json -Depth 10
  Set-Content -Path $settingsPath -Value $json -Encoding UTF8
}

function Ensure-Property($obj, $name, $default) {
  if (-not $obj.PSObject.Properties.Name -contains $name) {
    $obj | Add-Member -MemberType NoteProperty -Name $name -Value $default -Force
  }
  return $obj.$name
}

function Has-OurHook($hooksArray) {
  foreach ($entry in $hooksArray) {
    foreach ($h in $entry.hooks) {
      if ($h.PSObject.Properties.Name -contains $marker) { return $true }
    }
  }
  return $false
}

function Make-Hook($sigName) {
  $cmd = "Set-Content -Path `"`$env:TEMP\$sigName`" -Value (Get-Date -Format 'o')"
  return [pscustomobject]@{
    type    = "command"
    command = $cmd
    shell   = "powershell"
    async   = $true
    $marker = "v1"
  }
}

$settings = Read-Settings
$hooks = Ensure-Property $settings "hooks" ([pscustomobject]@{})

$events = @{
  Stop              = "claude-notify-stop.sig"
  Notification      = "claude-notify-idle.sig"
  PermissionRequest = "claude-notify-permission.sig"
}

$added = @()
foreach ($evt in $events.Keys) {
  $arr = Ensure-Property $hooks $evt @()
  if (-not ($arr -is [System.Collections.IEnumerable])) { $arr = @() }

  if (Has-OurHook $arr) {
    Write-Host "[skip] $evt already has Claude Notify hook"
    continue
  }
  $newEntry = [pscustomobject]@{ hooks = @(Make-Hook $events[$evt]) }
  $arr = @($arr) + $newEntry
  $hooks.$evt = $arr
  $added += $evt
  Write-Host "[add ] $evt -> writes $($events[$evt])"
}

# Legacy migration: detect any local hook still writing claude-notify-flash.sig and offer to migrate.
$legacyFound = $false
foreach ($evt in $hooks.PSObject.Properties.Name) {
  foreach ($entry in $hooks.$evt) {
    foreach ($h in $entry.hooks) {
      if ($h.command -match "claude-notify-flash\.sig") { $legacyFound = $true }
    }
  }
}
if ($legacyFound) {
  $resp = Read-Host "Detected legacy 'claude-notify-flash.sig' hook. Migrate to claude-notify-stop.sig? (y/n)"
  if ($resp -eq "y") {
    foreach ($evt in $hooks.PSObject.Properties.Name) {
      foreach ($entry in $hooks.$evt) {
        foreach ($h in $entry.hooks) {
          if ($h.command -match "claude-notify-flash\.sig") {
            $h.command = $h.command -replace "claude-notify-flash\.sig", "claude-notify-stop.sig"
            Write-Host "[mig ] migrated legacy hook in '$evt'"
          }
        }
      }
    }
  }
}

if ($added.Count -gt 0 -or $legacyFound) {
  $settings.hooks = $hooks
  Write-Settings $settings
  Write-Host "`nDone. Wrote $settingsPath"
} else {
  Write-Host "`nNo changes needed."
}
```

- [ ] **Step 14.2: Smoke-test `install-hooks.ps1` against a temp HOME**

Run:
```powershell
$env:USERPROFILE_OLD = $env:USERPROFILE
$tmpHome = New-Item -ItemType Directory -Force -Path "$env:TEMP\hookstest-$(Get-Random)"
$env:USERPROFILE = $tmpHome.FullName
powershell -ExecutionPolicy Bypass -File .\install-hooks.ps1
Get-Content "$($tmpHome.FullName)\.claude\settings.json"
$env:USERPROFILE = $env:USERPROFILE_OLD
Remove-Item -Recurse -Force $tmpHome
```
Expected: prints settings.json containing all three hooks with the `_claude-notify-installer: "v1"` marker. Re-running prints `[skip]` lines.

- [ ] **Step 14.3: Write `README.md`**

```markdown
# Claude Notify — Stream Deck plugin

Flash a Stream Deck button on Claude Code hook events (task complete, idle, permission request). Works for local Claude on Windows and remote Claude over SSH.

![preview](com.nshopik.claudenotify.sdPlugin/previews/main.png)

## Features

- One configurable Stream Deck action: place it as many times as you want, configure each instance for a single event type.
- Three events covered: **Stop** (Claude finished), **Idle** (Claude waiting for input), **Permission** (Claude wants approval).
- Static or pulsing flash mode, configurable per button.
- Optional audio cue per event, defaulting to Windows system sounds, with per-event source filter (remote-only by default to avoid doubling up with local PowerShell sound hooks).
- Works for remote Claude sessions via SSH reverse tunnel — your local deck flashes when Claude finishes on a remote machine.

## Installation

### Option A — install built `.streamDeckPlugin` (release)

1. Download the latest `.streamDeckPlugin` from the [releases page](https://github.com/nshopik/claudenotify/releases).
2. Double-click the file. Stream Deck software installs the plugin.

### Option B — build from source (development)

```
git clone https://github.com/nshopik/claudenotify
cd claudenotify
npm install
npm run build
npx streamdeck link com.nshopik.claudenotify.sdPlugin
```

## Local hook installation (Windows)

Install the three Claude hooks that signal the plugin:

```
powershell -ExecutionPolicy Bypass -File .\install-hooks.ps1
```

The script edits `~/.claude/settings.json` additively, marks each added hook with a versioned tag for idempotency, and offers to migrate any legacy `claude-notify-flash.sig` hook to the new naming.

## Remote setup (Linux / macOS)

When Claude Code runs on a remote machine you reach via SSH, its hooks can flash buttons on your local Stream Deck — identical behaviour to local Claude.

### How it works

The plugin on your Windows machine listens for HTTP POSTs on `127.0.0.1:9123`. Each Claude hook on the remote machine is a one-line `curl` to its own `localhost:9123`. SSH is configured with a *reverse* port-forward (`-R 9123:127.0.0.1:9123`), so the remote's `localhost:9123` is tunneled back through SSH to your Windows machine's listener. Nothing is exposed publicly; the SSH tunnel is the only path in.

### Prerequisites

- The Claude Notify plugin is installed and running on your Windows machine.
- HTTP listener is enabled in the plugin's global settings (default: enabled, port 9123).
- You can SSH into the remote machine.
- `curl` is available on the remote (default on every mainstream Linux/macOS distribution).
- The remote's sshd allows `RemoteForward` (default — `AllowTcpForwarding yes`).

### Setup — once per remote host

**Step 1. Add a reverse-forward to your local SSH config**

Edit `~/.ssh/config` on your **Windows** machine (`C:\Users\<you>\.ssh\config`) and add:

```
Host my-dev-vm
  HostName dev-vm.example.com
  User you
  RemoteForward 9123 127.0.0.1:9123
```

For all hosts, use `Host *`. To do it ad-hoc, prepend `-R 9123:127.0.0.1:9123` to your `ssh` command.

**Step 2. Add the three hooks to the remote's `~/.claude/settings.json`**

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [
        { "type": "command",
          "command": "curl -s --max-time 1 -X POST http://localhost:9123/event/stop >/dev/null 2>&1 &",
          "async": true }
      ]}
    ],
    "Notification": [
      { "hooks": [
        { "type": "command",
          "command": "curl -s --max-time 1 -X POST http://localhost:9123/event/idle >/dev/null 2>&1 &",
          "async": true }
      ]}
    ],
    "PermissionRequest": [
      { "hooks": [
        { "type": "command",
          "command": "curl -s --max-time 1 -X POST http://localhost:9123/event/permission >/dev/null 2>&1 &",
          "async": true }
      ]}
    ]
  }
}
```

`--max-time 1` keeps Claude unblocked if the tunnel is down; `&` makes the hook non-blocking; `>/dev/null 2>&1` suppresses output.

### Verify it works

After connecting (or reconnecting) to the remote with the reverse-forward in place:

**Check the tunnel** — from the remote shell:
```
curl -i http://localhost:9123/health
```
Expected: `HTTP/1.1 200 OK`. If you see `connection refused` or a timeout, the tunnel is not forwarding — see Troubleshooting.

**Fire a test event** — from the remote shell:
```
curl -X POST http://localhost:9123/event/stop
```
A button on your local Stream Deck configured for Stop should flash.

**Trigger a real Claude event** — run a short Claude task on the remote and wait for it to finish; the Stop hook fires, the deck flashes.

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `curl: connection refused` from remote | SSH session opened without `-R`; or plugin not running on Windows; or HTTP listener disabled in plugin settings | Reconnect ensuring `-R 9123:127.0.0.1:9123` is set; verify plugin's global settings show "HTTP listener: listening on 127.0.0.1:9123" |
| Tunnel responds but deck doesn't flash | No button configured for that event type, or the button's event type is different | Open Property Inspector on a button, set Event type to match (Stop / Idle / Permission); use the per-button Test button to verify |
| `bind: Address already in use` warning when SSH connects | A previous SSH session to the same remote is still holding the reverse port | Disconnect the old session; or pick a different port (change plugin global setting + `-R` line + curl URLs to match) |
| `Permission denied` or "channel 3: open failed" on `-R` | Remote sshd has `AllowTcpForwarding no` (rare, hardened servers) | Ask sysadmin to enable; or use a different transport (out of scope) |
| `bash: curl: command not found` on remote | Minimal container/distro without curl | Install curl, or substitute the hook with `wget -q --tries=1 --timeout=1 --method=POST http://localhost:9123/event/stop -O /dev/null &` |
| Multiple concurrent Claude sessions to same remote, only one flashes | The `-R` reverse port can only be bound once per remote | Expected. Hooks from non-bound sessions silently fail (`--max-time 1` swallows the error). Use one Claude session per remote, or distinct ports per session |
| Plugin says HTTP listener "failed to bind" on Windows | Port 9123 is in use by something else on Windows | Change `httpPort` in plugin global settings; update `-R` line and remote curl URLs to match |
| WSL2 on the same Windows box | WSL2 default NAT means `localhost:9123` from inside WSL doesn't reach the Windows host | Use Windows 11 mirrored networking (`[wsl2] networkingMode=mirrored` in `.wslconfig`); or treat WSL like a remote and tunnel via SSH-to-WSL |

### What the plugin does *not* do

The plugin does not write to either machine's `~/.claude/settings.json`, does not establish the SSH tunnel for you, and does not modify your `~/.ssh/config`. All three are one-time manual setup steps owned by you.

## Configuration reference

### Per-button settings (Property Inspector)

- **Event type** — which Claude event this button reacts to (Stop / Idle / Permission). Default: Idle.
- **Idle / Alert icon** — optional file overrides; empty = use the bundled default for the chosen event.
- **Flash mode** — Static (icon swap) or Pulse (toggle every N ms).
- **Pulse rate** — milliseconds between toggles when Pulse is selected. Min 100ms (Elgato's 10/sec key-update cap).
- **Auto-dismiss** — seconds. 0 = never auto-dismiss.
- **Test flash** — fires a synthetic alert on this button.

### Plugin-global settings (More Actions → plugin settings)

- **HTTP listener** — toggle + port (default 9123).
- **Audio per event** — enabled, source filter (all / remote / local), sound file (defaults to system WAVs), volume %.
- **▶ Test** — plays the configured sound at the configured volume.

## Development

```
npm install
npm test            # run vitest
npm run dev         # rollup watch mode
npm run typecheck   # tsc --noEmit
npm run pack        # streamdeck pack -> .streamDeckPlugin
```

## License

MIT
```

- [ ] **Step 14.4: Commit**

```
git add install-hooks.ps1 README.md
git commit -m "Hook installer + README with remote setup user guide"
```

---

## Task 15: Cleanup of prior plugin install + manual end-to-end verification

This task is mostly manual — it cannot be automated reliably because it depends on the live Stream Deck software, hardware, and a remote box. Treat each step as a checkpoint.

- [ ] **Step 15.1: Stop the previous plugin in Stream Deck software**

Open Stream Deck software → Settings → Plugins. Find "Claude Notify" → toggle off (or right-click → Disable). Quit Stream Deck software entirely (system tray → Quit).

- [ ] **Step 15.2: Remove the previous plugin install**

```powershell
$old = Join-Path $env:APPDATA "Elgato\StreamDeck\Plugins\com.nshopik.claudenotify.sdPlugin"
if (Test-Path $old) {
  Write-Host "Removing $old"
  Remove-Item -Recurse -Force $old
} else {
  Write-Host "Nothing to remove."
}
```
Expected: directory removed (including its `claude-notify-plugin-backup` subfolder).

- [ ] **Step 15.3: Remove legacy sig file**

```powershell
$legacy = Join-Path $env:TEMP "claude-notify-flash.sig"
if (Test-Path $legacy) { Remove-Item -Force $legacy }
```

- [ ] **Step 15.4: Build and link the new plugin**

Run:
```
npm run build
npx streamdeck link com.nshopik.claudenotify.sdPlugin
```
Expected: build succeeds; `streamdeck link` reports the plugin is loaded. Restart Stream Deck software if it was running.

- [ ] **Step 15.5: Verify the action appears**

Open Stream Deck software → action list. "Claude Notify" → "Flash" should appear with the bundled icons.

- [ ] **Step 15.6: Place three buttons**

Place the Flash action three times on your deck. For each, open Property Inspector and set Event type to Stop / Idle / Permission respectively. Press the per-button "Test flash" button — confirm each lights up correctly.

- [ ] **Step 15.7: Install local hooks**

```
powershell -ExecutionPolicy Bypass -File .\install-hooks.ps1
```
Expected: prints `[add ] Stop`, `[add ] Notification`, `[add ] PermissionRequest`. Inspect `~/.claude/settings.json` to confirm.

- [ ] **Step 15.8: End-to-end local test — Stop**

In a Claude Code session on Windows, run any short task and wait for it to finish. Expected: the Stop button on the deck flashes; pressing it dismisses; not pressing it auto-dismisses after 30s. Test all three dismissal paths (press, timeout, next event).

- [ ] **Step 15.9: End-to-end remote test — HTTP path**

SSH into a test remote machine with `-R 9123:127.0.0.1:9123`:
```
ssh -R 9123:127.0.0.1:9123 you@dev-vm
```
On the remote shell, run:
```
curl -i http://localhost:9123/health
curl -X POST http://localhost:9123/event/stop
```
Expected: `/health` returns 200 OK; `/event/stop` triggers the Stop button on the local deck AND plays `Speech On.wav` on the local speakers.

- [ ] **Step 15.10: End-to-end remote test — real Claude event**

Add the remote hooks (per README's Remote Setup) to the remote's `~/.claude/settings.json`. Run a short Claude task on the remote. Expected: when Claude finishes, local deck flashes Stop and local speaker plays Speech On.wav.

- [ ] **Step 15.11: Pack a distributable**

```
npm run pack
```
Expected: `com.nshopik.claudenotify.streamDeckPlugin` file produced in the project root. Validate by double-clicking — Stream Deck should re-install cleanly from the packaged file.

- [ ] **Step 15.12: Final commit**

```
git status
git add -A
git commit -m "End-to-end verification complete; v1.0.0 ready"
```
(Only if there are stray changes — typically nothing to commit at this point.)

---

## Self-review summary

**Spec coverage**:
- Per-event sig files → Task 5
- HTTP listener bound to 127.0.0.1 → Task 6
- Both ingest paths feed shared dispatcher → Task 8 (dispatcher) + Task 13 (wiring in plugin.ts)
- "Next event clears" rule → Task 8 Step 8.9 (test) + dispatcher implementation
- Three dismissal paths (press / timeout / next event) → Task 9 (FlashAction) + Task 8 (dispatcher dismisses on next event)
- Static + pulse modes → Task 9 alertContext implementation
- Pulse rate clamp ≥100ms → Task 9 (`Math.max(100, ...)`) + Task 11 (PI `min="100"`)
- System sound defaults → Task 4 + Task 8 dispatcher
- Volume cache → Task 7 (steps 7.7–7.12)
- Source filter default "remote" → Task 3 (DEFAULT_GLOBAL_SETTINGS) + Task 8 tests
- DRM-recommended manifest → Task 2 (SDKVersion 3, MinimumVersion 6.9)
- Image asset categories (plugin icon, category, action, key, previews) → Task 10
- install-hooks.ps1 idempotency + legacy migration → Task 14 Step 14.1
- README remote setup user guide → Task 14 Step 14.3
- Cleanup of prior plugin → Task 15 Steps 15.1–15.3

**Type consistency check**:
- `dispatch(event: EventType, source: EventSource)` — defined in Task 8, used in Task 13 wiring. ✓
- `play(wavPath: string, volumePercent: number)` — defined in Task 7, called from Task 8 + Task 13. ✓
- `defaultSoundPath(event: EventType)` — defined in Task 4, used in Tasks 8 + 13. ✓
- `keyIconBase64(event, kind)` — defined in Task 9 icons.ts, used in flash-action. ✓
- `SignalWatcher({ tmpDir, onSignal })` — defined in Task 5, used in Task 13. ✓
- `HttpListener({ port, onEvent })` — defined in Task 6, used in Task 13. ✓
- `AudioPlayer({ spawn?, cacheDir? })` — defined in Task 7, used in Task 13. ✓

**Judgment calls** (made by author of plan, flagged for engineer awareness):
- Test framework: **Vitest** (over Jest/Mocha) for ESM-native TS support, fast startup, modern DX.
- Property Inspector: uses `sdpi-components` from CDN (`sdpi-components.dev/releases/v3/...`). Marketplace submission may require vendoring — leave for distribution-prep follow-up.
- Image generation: ImageMagick command-line. If unavailable, fall back to manual SVG export from any vector editor.
- Bundled icon designs are simple geometric placeholders. Polish the visual style during marketplace prep.
- The SDK's API surface for plugin-level `onSendToPlugin` differs by version; `streamDeck.ui.onSendToPlugin?.` is used defensively. If the call signature changes, adapt in Task 13.
