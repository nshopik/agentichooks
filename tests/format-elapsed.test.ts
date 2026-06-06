import { describe, it, expect } from "vitest";
import { formatElapsed } from "../src/format-elapsed.js";

describe("formatElapsed", () => {
  // Clamp
  it("negative input clamps to '0s'", () => {
    expect(formatElapsed(-1)).toBe("0s");
  });

  // Seconds tier (< 60 000 ms)
  it("0 ms → '0s'", () => {
    expect(formatElapsed(0)).toBe("0s");
  });

  it("59 999 ms → '59s' (last second in seconds tier)", () => {
    expect(formatElapsed(59_999)).toBe("59s");
  });

  // Minutes tier (60 000 – 3 599 999 ms), format m:ss
  it("60 000 ms → '1:00' (first value in minutes tier)", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
  });

  it("3 599 999 ms → '59:59' (last value in minutes tier)", () => {
    expect(formatElapsed(3_599_999)).toBe("59:59");
  });

  // Hours < 10 tier (3 600 000 – 35 999 999 ms), format h:mm:ss
  it("3 600 000 ms → '1:00:00' (first value in hours-<10 tier)", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
  });

  it("35 999 999 ms → '9:59:59' (last value in hours-<10 tier)", () => {
    expect(formatElapsed(35_999_999)).toBe("9:59:59");
  });

  // Hours >= 10 tier (≥ 36 000 000 ms), format hh:mm (seconds dropped)
  it("36 000 000 ms → '10:00' (first value in hours->=10 tier)", () => {
    expect(formatElapsed(36_000_000)).toBe("10:00");
  });

  it("38 640 000 ms → '10:44' (minutes zero-padded in >=10h tier)", () => {
    expect(formatElapsed(38_640_000)).toBe("10:44");
  });

  it("minutes zero-padding in >=10h tier: 36 240 000 ms → '10:04'", () => {
    expect(formatElapsed(36_240_000)).toBe("10:04");
  });

  // Seconds zero-padding in minutes tier
  it("seconds zero-padding in minutes tier: 65 000 ms → '1:05'", () => {
    expect(formatElapsed(65_000)).toBe("1:05");
  });

  // Seconds and minutes zero-padding in h:mm:ss tier
  it("seconds zero-padding in hours-<10 tier: 3 665 000 ms → '1:01:05'", () => {
    expect(formatElapsed(3_665_000)).toBe("1:01:05");
  });
});
