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
      const w = fs.watch(filePath, () => this.handleChange(event, filePath));
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

  private handleChange(event: EventType, filePath: string): void {
    const existing = this.debounceTimers[event];
    if (existing) clearTimeout(existing);
    this.debounceTimers[event] = setTimeout(() => {
      this.debounceTimers[event] = null;
      let stat: fs.Stats;
      try { stat = fs.statSync(filePath); } catch { return; }
      if (stat.mtimeMs <= this.lastMtimeMs[event]) return;
      this.lastMtimeMs[event] = stat.mtimeMs;
      this.opts.onSignal(event);
    }, DEBOUNCE_MS);
  }
}
