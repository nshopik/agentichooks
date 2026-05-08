import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cp from "node:child_process";

const POWERSHELL_PATH = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

export type SpawnFn = (command: string, args: ReadonlyArray<string>, opts?: cp.SpawnOptions) => SpawnedChild;
export type SpawnedChild = { unref(): void; on?: (event: string, listener: (...args: unknown[]) => void) => unknown };
export type LogLevel = "info" | "warn" | "error";
export type LogFn = (level: LogLevel, msg: string) => void;

export type AudioPlayerOpts = {
  spawn?: SpawnFn;
  cacheDir?: string;
  log?: LogFn;
};

export class AudioPlayer {
  private spawn: SpawnFn;
  private cacheDir: string;
  private log: LogFn;
  private warnedMissing = new Set<string>();

  constructor(opts: AudioPlayerOpts = {}) {
    this.spawn = opts.spawn ?? ((cmd, args, o) => cp.spawn(cmd, args as string[], o ?? {}) as unknown as SpawnedChild);
    this.cacheDir = opts.cacheDir ?? path.join(process.env.TEMP ?? process.env.TMPDIR ?? ".", "claude-notify-cache");
    this.log = opts.log ?? ((level, msg) => { (level === "info" ? console.info : level === "warn" ? console.warn : console.error)(`[claude-notify] audio: ${msg}`); });
  }

  play(wavPath: string, volumePercent: number): void {
    this.log("info", `play() called: path=${wavPath} vol=${volumePercent}`);
    if (!fs.existsSync(wavPath)) {
      const key = `${wavPath}|${volumePercent}`;
      if (!this.warnedMissing.has(key)) {
        this.warnedMissing.add(key);
        this.log("warn", `file missing: ${wavPath}`);
      }
      return;
    }
    const playPath = volumePercent === 100 ? wavPath : this.ensureVolumeAdjusted(wavPath, volumePercent);
    if (!playPath) {
      this.log("warn", `play() aborted: ensureVolumeAdjusted returned null for ${wavPath} @ ${volumePercent}%`);
      return;
    }
    const escaped = playPath.replace(/'/g, "''");
    const psCommand = `(New-Object Media.SoundPlayer '${escaped}').PlaySync()`;
    this.log("info", `spawning ${POWERSHELL_PATH} for ${playPath}`);
    // Note: do NOT pass `detached: true`. On Windows that adds DETACHED_PROCESS to CreateProcess,
    // which causes Media.SoundPlayer.PlaySync() to return immediately without playing audio.
    const child = this.spawn(POWERSHELL_PATH, ["-NoProfile", "-Command", psCommand], { stdio: "ignore", windowsHide: true });
    if (typeof child.on === "function") {
      child.on("error", (err) => this.log("error", `spawn error: ${err}`));
      child.on("exit", (code, signal) => this.log("info", `child exit code=${code} signal=${signal}`));
    }
    child.unref();
  }

  private ensureVolumeAdjusted(wavPath: string, volumePercent: number): string | null {
    if (!fs.existsSync(this.cacheDir)) fs.mkdirSync(this.cacheDir, { recursive: true });
    const hash = crypto.createHash("sha1").update(wavPath).digest("hex").slice(0, 16);
    const cachePath = path.join(this.cacheDir, `${hash}-${volumePercent}.wav`);
    if (fs.existsSync(cachePath)) {
      this.log("info", `cache hit: ${cachePath}`);
      return cachePath;
    }
    try {
      const src = fs.readFileSync(wavPath);
      const adjusted = adjustWavVolume(src, volumePercent, this.log);
      if (!adjusted) return null;
      fs.writeFileSync(cachePath, adjusted);
      this.log("info", `cache write: ${cachePath}`);
      return cachePath;
    } catch (e) {
      this.log("warn", `failed to adjust volume for ${wavPath}: ${e}`);
      return null;
    }
  }
}

function adjustWavVolume(buf: Buffer, volumePercent: number, log: LogFn): Buffer | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    log("warn", "not a WAV file");
    return null;
  }
  const bitsPerSample = buf.readUInt16LE(34);
  if (bitsPerSample !== 16) {
    log("warn", `only 16-bit PCM WAV supported (got ${bitsPerSample}-bit)`);
    return null;
  }
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
