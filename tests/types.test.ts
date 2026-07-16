import { describe, it, expect } from "vitest";
import { normalizeFlashMode, DEFAULT_FLASH_SETTINGS, DEFAULT_GLOBAL_SETTINGS } from "../src/types.js";

describe("normalizeFlashMode", () => {
  it("passes through 'static'", () => {
    expect(normalizeFlashMode("static")).toBe("static");
  });

  it("passes through 'pulse'", () => {
    expect(normalizeFlashMode("pulse")).toBe("pulse");
  });

  it("falls back to the default for an unknown string", () => {
    expect(normalizeFlashMode("blink")).toBe(DEFAULT_FLASH_SETTINGS.flashMode);
  });

  it("falls back to the default for a non-string value", () => {
    expect(normalizeFlashMode(42)).toBe(DEFAULT_FLASH_SETTINGS.flashMode);
  });

  it("non-(static|pulse) input falls back to default", () => {
    expect(normalizeFlashMode(undefined)).toBe(DEFAULT_FLASH_SETTINGS.flashMode);
    expect(normalizeFlashMode(null)).toBe(DEFAULT_FLASH_SETTINGS.flashMode);
    expect(normalizeFlashMode([])).toBe(DEFAULT_FLASH_SETTINGS.flashMode);
  });
});

describe("DEFAULT_GLOBAL_SETTINGS.alertDelay", () => {
  it("defaults stop to 0 ms (background_tasks is the completion signal, not a timer)", () => {
    expect(DEFAULT_GLOBAL_SETTINGS.alertDelay.stop).toBe(0);
  });

  it("keeps permission and task-completed at the 1000 ms default", () => {
    expect(DEFAULT_GLOBAL_SETTINGS.alertDelay.permission).toBe(1000);
    expect(DEFAULT_GLOBAL_SETTINGS.alertDelay["task-completed"]).toBe(1000);
  });
});
