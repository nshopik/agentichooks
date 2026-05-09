import fs from "node:fs";
import path from "node:path";
import * as cp from "node:child_process";

const POWERSHELL_PATH = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

const AFPLAY_PATH = "/usr/bin/afplay";

export type SpawnFn = (command: string, args: ReadonlyArray<string>, opts?: cp.SpawnOptions) => SpawnedChild;
export type SpawnedChild = { unref(): void; on?: (event: string, listener: (...args: unknown[]) => void) => unknown };
export type LogLevel = "info" | "warn" | "error";
export type LogFn = (level: LogLevel, msg: string) => void;

export type AudioPlayerOpts = {
  spawn?: SpawnFn;
  log?: LogFn;
  platform?: NodeJS.Platform;
};

export class AudioPlayer {
  private spawn: SpawnFn;
  private log: LogFn;
  private platform: NodeJS.Platform;
  private warnedMissing = new Set<string>();

  constructor(opts: AudioPlayerOpts = {}) {
    this.spawn = opts.spawn ?? ((cmd, args, o) => cp.spawn(cmd, args as string[], o ?? {}) as unknown as SpawnedChild);
    this.log = opts.log ?? ((level, msg) => { (level === "info" ? console.info : level === "warn" ? console.warn : console.error)(`[agentic-hooks] audio: ${msg}`); });
    this.platform = opts.platform ?? process.platform;
  }

  play(wavPath: string): void {
    this.log("info", `play() called: path=${wavPath} platform=${this.platform}`);
    if (!fs.existsSync(wavPath)) {
      if (!this.warnedMissing.has(wavPath)) {
        this.warnedMissing.add(wavPath);
        this.log("warn", `file missing: ${wavPath}`);
      }
      return;
    }
    if (this.platform === "darwin") {
      this.playDarwin(wavPath);
    } else {
      this.playWindows(wavPath);
    }
  }

  private playWindows(wavPath: string): void {
    const escaped = wavPath.replace(/'/g, "''");
    const psCommand = `(New-Object Media.SoundPlayer '${escaped}').PlaySync()`;
    this.log("info", `spawning ${POWERSHELL_PATH} for ${wavPath}`);
    // Note: do NOT pass `detached: true`. On Windows that adds DETACHED_PROCESS to CreateProcess,
    // which causes Media.SoundPlayer.PlaySync() to return immediately without playing audio.
    const child = this.spawn(POWERSHELL_PATH, ["-NoProfile", "-Command", psCommand], { stdio: "ignore", windowsHide: true });
    this.attachLifecycle(child);
  }

  private playDarwin(wavPath: string): void {
    this.log("info", `spawning ${AFPLAY_PATH} for ${wavPath}`);
    const child = this.spawn(AFPLAY_PATH, [wavPath], { stdio: "ignore" });
    this.attachLifecycle(child);
  }

  private attachLifecycle(child: SpawnedChild): void {
    if (typeof child.on === "function") {
      child.on("error", (err) => this.log("error", `spawn error: ${err}`));
      child.on("exit", (code, signal) => this.log("info", `child exit code=${code} signal=${signal}`));
    }
    child.unref();
  }
}
