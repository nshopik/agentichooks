import { describe, it, expect } from "vitest";
import { normalizeFlashMode, DEFAULT_FLASH_SETTINGS } from "../src/types.js";

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

  it("falls back to the default for undefined", () => {
    expect(normalizeFlashMode(undefined)).toBe(DEFAULT_FLASH_SETTINGS.flashMode);
  });

  it("falls back to the default for null", () => {
    expect(normalizeFlashMode(null)).toBe(DEFAULT_FLASH_SETTINGS.flashMode);
  });
});
