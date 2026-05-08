import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AudioPlayer } from "../src/audio-player.js";

type SpawnCall = { cmd: string; args: string[]; opts: Record<string, unknown> };
let spawnCalls: SpawnCall[];
let cacheDir: string;

const fakeSpawn: import("../src/audio-player.js").SpawnFn = (cmd, args, opts) => {
  spawnCalls.push({ cmd, args: [...args], opts: (opts ?? {}) as Record<string, unknown> });
  return { unref() {} };
};

function writeMinimalWav(filePath: string): void {
  const sampleRate = 22050;
  const numSamples = 1024;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
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
  it("does not spawn when file is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const player = new AudioPlayer({ spawn: fakeSpawn, cacheDir });
    player.play("C:\\nope\\nothing.wav", 100);
    expect(spawnCalls.length).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("at volume 100, spawns with original path", () => {
    const wav = path.join(cacheDir, "src.wav");
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, cacheDir });
    player.play(wav, 100);
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].cmd).toMatch(/powershell\.exe$/i);
    expect(spawnCalls[0].args).toEqual([
      "-NoProfile",
      "-Command",
      `(New-Object Media.SoundPlayer '${wav}').PlaySync()`,
    ]);
  });

  it("at volume 80, caches a volume-adjusted copy and spawns with cache path", () => {
    const wav = path.join(cacheDir, "src.wav");
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, cacheDir });
    player.play(wav, 80);
    expect(spawnCalls.length).toBe(1);
    const calledPath = spawnCalls[0].args[2].match(/SoundPlayer '(.+)'/)?.[1];
    expect(calledPath).toBeDefined();
    expect(calledPath).not.toBe(wav);
    expect(fs.existsSync(calledPath!)).toBe(true);
    expect(path.basename(calledPath!)).toMatch(/^[0-9a-f]{16}-80\.wav$/);
  });

  it("at volume 80 with existing cache, does not re-encode", () => {
    const wav = path.join(cacheDir, "src.wav");
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, cacheDir });
    player.play(wav, 80);
    const firstCachePath = spawnCalls[0].args[2].match(/SoundPlayer '(.+)'/)?.[1]!;
    const firstMtime = fs.statSync(firstCachePath).mtimeMs;
    spawnCalls = [];
    player.play(wav, 80);
    const secondCachePath = spawnCalls[0].args[2].match(/SoundPlayer '(.+)'/)?.[1]!;
    expect(secondCachePath).toBe(firstCachePath);
    expect(fs.statSync(secondCachePath).mtimeMs).toBe(firstMtime);
  });

  it("escapes single quotes in path by doubling", () => {
    const wavName = "with's quote.wav";
    const wav = path.join(cacheDir, wavName);
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, cacheDir });
    player.play(wav, 100);
    expect(spawnCalls[0].args[2]).toContain(wav.replace(/'/g, "''"));
    expect(spawnCalls[0].args[2]).not.toContain(`'${wav}'`);
  });

  it("does not spawn with detached:true (DETACHED_PROCESS breaks Media.SoundPlayer.PlaySync on Windows)", () => {
    const wav = path.join(cacheDir, "src.wav");
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, cacheDir });
    player.play(wav, 100);
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].opts.detached).not.toBe(true);
  });

  it("skips non-16-bit WAVs with a warning", () => {
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
    const player = new AudioPlayer({ spawn: fakeSpawn, cacheDir });
    player.play(wav, 80);
    expect(spawnCalls.length).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
