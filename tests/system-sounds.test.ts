import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { EventType } from "../src/types.js";
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

  it.each<[EventType, string]>([
    ["stop", "C:\\Windows\\Media\\Speech On.wav"],
    ["permission", "C:\\Windows\\Media\\Windows Message Nudge.wav"],
  ])("returns the default sound path for %s", (event, expected) => {
    expect(defaultSoundPath(event, "win32")).toBe(expected);
  });

  it("returns undefined for task-completed (no default sound)", () => {
    expect(defaultSoundPath("task-completed", "win32")).toBeUndefined();
  });

  it("falls back to C:\\Windows when SystemRoot unset", () => {
    delete process.env.SystemRoot;
    expect(defaultSoundPath("stop", "win32")).toBe("C:\\Windows\\Media\\Speech On.wav");
  });

  it("honors a custom SystemRoot for the media root", () => {
    // Pins the env-var read: with the beforeEach default equal to the fallback,
    // nothing else in the suite could distinguish "read SystemRoot" from
    // "hardcode C:\\Windows".
    process.env.SystemRoot = "D:\\CustomWin";
    expect(defaultSoundPath("stop", "win32")).toBe("D:\\CustomWin\\Media\\Speech On.wav");
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

  it.each<[EventType, string]>([
    ["stop", "/System/Library/Sounds/Glass.aiff"],
    ["permission", "/System/Library/Sounds/Funk.aiff"],
  ])("returns the default sound path for %s", (event, expected) => {
    expect(defaultSoundPath(event, "darwin")).toBe(expected);
  });

  it("does not consult SystemRoot on darwin", () => {
    process.env.SystemRoot = "C:\\nonsense";
    expect(defaultSoundPath("stop", "darwin")).toBe("/System/Library/Sounds/Glass.aiff");
  });
});
