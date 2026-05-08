import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignalWatcher } from "../src/signal-watcher.js";
import type { SignalType } from "../src/types.js";

let tmpDir: string;
let received: Array<{ event: SignalType; t: number }>;
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
  it("creates missing sig files at start()", () => {
    watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
    watcher.start();
    expect(fs.existsSync(path.join(tmpDir, "claude-notify-stop.sig"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "claude-notify-permission.sig"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "claude-notify-task-completed.sig"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "claude-notify-active.sig"))).toBe(true);
  });

  it("emits 'active' for claude-notify-active.sig", async () => {
    watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
    watcher.start();
    await sleep(20);
    fs.writeFileSync(path.join(tmpDir, "claude-notify-active.sig"), new Date().toISOString());
    await sleep(150);
    expect(received.map((r) => r.event)).toEqual(["active"]);
  });

  it("emits onSignal with event type when sig file changes", async () => {
    watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
    watcher.start();
    await sleep(20);
    fs.writeFileSync(path.join(tmpDir, "claude-notify-stop.sig"), new Date().toISOString());
    await sleep(150);
    expect(received.map((r) => r.event)).toEqual(["stop"]);
  });

  it("debounces rapid writes within 50ms to one onSignal", async () => {
    watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
    watcher.start();
    await sleep(20);
    const file = path.join(tmpDir, "claude-notify-permission.sig");
    fs.writeFileSync(file, "1");
    fs.writeFileSync(file, "2");
    fs.writeFileSync(file, "3");
    await sleep(150);
    expect(received.length).toBe(1);
    expect(received[0].event).toBe("permission");
  });

  it("ignores sig file that already had a recent write before start()", async () => {
    const file = path.join(tmpDir, "claude-notify-permission.sig");
    fs.writeFileSync(file, "old");
    await sleep(20);
    watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
    watcher.start();
    await sleep(150);
    expect(received.length).toBe(0);
  });

  it("routes each filename to the correct EventType", async () => {
    watcher = new SignalWatcher({ tmpDir, onSignal: (e) => received.push({ event: e, t: Date.now() }) });
    watcher.start();
    await sleep(20);
    fs.writeFileSync(path.join(tmpDir, "claude-notify-stop.sig"), "a");
    await sleep(120);
    fs.writeFileSync(path.join(tmpDir, "claude-notify-permission.sig"), "b");
    await sleep(120);
    fs.writeFileSync(path.join(tmpDir, "claude-notify-task-completed.sig"), "c");
    await sleep(150);
    expect(received.map((r) => r.event)).toEqual(["stop", "permission", "task-completed"]);
  });
});
