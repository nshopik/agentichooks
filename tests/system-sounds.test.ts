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

  it("returns Windows Message Nudge.wav for permission", () => {
    expect(defaultSoundPath("permission")).toBe("C:\\Windows\\Media\\Windows Message Nudge.wav");
  });

  it("returns undefined for task-completed (no default sound)", () => {
    expect(defaultSoundPath("task-completed")).toBeUndefined();
  });

  it("falls back to C:\\Windows when SystemRoot unset", () => {
    delete process.env.SystemRoot;
    expect(defaultSoundPath("stop")).toBe("C:\\Windows\\Media\\Speech On.wav");
  });
});

describe("defaultSoundPath — macOS", () => {
  let originalSystemRoot: string | undefined;

  beforeEach(() => {
    originalSystemRoot = process.env.SystemRoot;
  });

  afterEach(() => {
    if (originalSystemRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = originalSystemRoot;
  });

  it("returns Glass.aiff for stop", () => {
    expect(defaultSoundPath("stop", "darwin")).toBe("/System/Library/Sounds/Glass.aiff");
  });

  it("returns Funk.aiff for permission", () => {
    expect(defaultSoundPath("permission", "darwin")).toBe("/System/Library/Sounds/Funk.aiff");
  });

  it("returns undefined for task-completed", () => {
    expect(defaultSoundPath("task-completed", "darwin")).toBeUndefined();
  });

  it("does not consult SystemRoot on darwin", () => {
    process.env.SystemRoot = "C:\\nonsense";
    expect(defaultSoundPath("stop", "darwin")).toBe("/System/Library/Sounds/Glass.aiff");
  });
});
