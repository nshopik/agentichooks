import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import * as cp from "node:child_process";

export type SpawnFn = (command: string, args: ReadonlyArray<string>, opts?: cp.SpawnOptions) => { unref(): void };

export type AudioPlayerOpts = {
  spawn?: SpawnFn;
  cacheDir?: string;
};

export class AudioPlayer {
  private spawn: SpawnFn;
  private cacheDir: string;
  private warnedMissing = new Set<string>();

  constructor(opts: AudioPlayerOpts = {}) {
    this.spawn = opts.spawn ?? ((cmd, args, o) => cp.spawn(cmd, args as string[], o ?? {}) as unknown as { unref(): void });
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
