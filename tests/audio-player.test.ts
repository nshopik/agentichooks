import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AudioPlayer } from "../src/audio-player.js";

type SpawnCall = { cmd: string; args: string[]; opts: Record<string, unknown> };
let spawnCalls: SpawnCall[];
let tmpDir: string;

const fakeSpawn: import("../src/audio-player.js").SpawnFn = (cmd, args, opts) => {
  spawnCalls.push({ cmd, args: [...args], opts: (opts ?? {}) as Record<string, unknown> });
  return { unref() {} };
};

function writeMinimalWav(filePath: string): void {
  const buf = Buffer.alloc(44 + 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(40, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(22050, 24);
  buf.writeUInt32LE(22050 * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(4, 40);
  fs.writeFileSync(filePath, buf);
}

beforeEach(() => {
  spawnCalls = [];
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("AudioPlayer", () => {
  it("does not spawn when file is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const player = new AudioPlayer({ spawn: fakeSpawn, platform: "win32" });
    player.play("C:\\nope\\nothing.wav");
    expect(spawnCalls.length).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("warns once per missing path, not on every call", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const player = new AudioPlayer({ spawn: fakeSpawn, platform: "win32" });
    player.play("C:\\nope\\nothing.wav");
    player.play("C:\\nope\\nothing.wav");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("spawns powershell with the wav path on Windows", () => {
    const wav = path.join(tmpDir, "src.wav");
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, platform: "win32" });
    player.play(wav);
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].cmd).toMatch(/powershell\.exe$/i);
    expect(spawnCalls[0].args).toEqual([
      "-NoProfile",
      "-Command",
      `(New-Object Media.SoundPlayer '${wav}').PlaySync()`,
    ]);
  });

  it("escapes single quotes in path by doubling", () => {
    const wavName = "with's quote.wav";
    const wav = path.join(tmpDir, wavName);
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, platform: "win32" });
    player.play(wav);
    expect(spawnCalls[0].args[2]).toContain(wav.replace(/'/g, "''"));
    expect(spawnCalls[0].args[2]).not.toContain(`'${wav}'`);
  });

  it("does not spawn with detached:true (DETACHED_PROCESS breaks Media.SoundPlayer.PlaySync on Windows)", () => {
    const wav = path.join(tmpDir, "src.wav");
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, platform: "win32" });
    player.play(wav);
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].opts.detached).not.toBe(true);
  });
});

describe("AudioPlayer — macOS", () => {
  it("spawns afplay with the path as a single argv element", () => {
    const wav = path.join(tmpDir, "src.wav");
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, platform: "darwin" });
    player.play(wav);
    expect(spawnCalls.length).toBe(1);
    expect(spawnCalls[0].cmd).toBe("/usr/bin/afplay");
    expect(spawnCalls[0].args).toEqual([wav]);
  });

  it("does not spawn when file is missing on darwin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const player = new AudioPlayer({ spawn: fakeSpawn, platform: "darwin" });
    player.play("/nope/nothing.aiff");
    expect(spawnCalls.length).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("spawns afplay exactly once with no side-effect files", () => {
    const wav = path.join(tmpDir, "src.wav");
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, platform: "darwin" });
    player.play(wav);
    expect(spawnCalls.length).toBe(1);
    const entries = fs.readdirSync(tmpDir);
    expect(entries).toEqual(["src.wav"]);
  });

  it("does not pass paths through powershell quote-doubling on darwin", () => {
    const wavName = "with's quote.wav";
    const wav = path.join(tmpDir, wavName);
    writeMinimalWav(wav);
    const player = new AudioPlayer({ spawn: fakeSpawn, platform: "darwin" });
    player.play(wav);
    expect(spawnCalls[0].args).toEqual([wav]);
  });
});
