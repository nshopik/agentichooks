import fs from "node:fs";
import path from "node:path";
import type { SignalType } from "./types.js";

const FILES: Record<SignalType, string> = {
  stop: "claude-notify-stop.sig",
  idle: "claude-notify-idle.sig",
  permission: "claude-notify-permission.sig",
  "task-completed": "claude-notify-task-completed.sig",
  active: "claude-notify-active.sig",
  "active-soft": "claude-notify-active-soft.sig",
};

const DEBOUNCE_MS = 50;

export type SignalWatcherOpts = {
  tmpDir: string;
  onSignal: (signal: SignalType) => void;
};

export class SignalWatcher {
  private opts: SignalWatcherOpts;
  private watchers: fs.FSWatcher[] = [];
  private lastMtimeMs: Record<SignalType, number> = { stop: 0, idle: 0, permission: 0, "task-completed": 0, active: 0, "active-soft": 0 };
  private startupMs = 0;
  private debounceTimers: Record<SignalType, NodeJS.Timeout | null> = { stop: null, idle: null, permission: null, "task-completed": null, active: null, "active-soft": null };

  constructor(opts: SignalWatcherOpts) {
    this.opts = opts;
  }

  start(): void {
    this.startupMs = Date.now();
    for (const signal of Object.keys(FILES) as SignalType[]) {
      const filePath = path.join(this.opts.tmpDir, FILES[signal]);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, "");
      }
      const stat = fs.statSync(filePath);
      this.lastMtimeMs[signal] = stat.mtimeMs;
      const w = fs.watch(filePath, () => this.handleChange(signal, filePath));
      this.watchers.push(w);
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

  private handleChange(signal: SignalType, filePath: string): void {
    const existing = this.debounceTimers[signal];
    if (existing) clearTimeout(existing);
    this.debounceTimers[signal] = setTimeout(() => {
      this.debounceTimers[signal] = null;
      let stat: fs.Stats;
      try { stat = fs.statSync(filePath); } catch { return; }
      if (stat.mtimeMs <= this.lastMtimeMs[signal]) return;
      this.lastMtimeMs[signal] = stat.mtimeMs;
      this.opts.onSignal(signal);
    }, DEBOUNCE_MS);
  }
}
