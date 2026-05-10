import { describe, it, expect } from "vitest";
import { pickLogLevel } from "../src/log-level.js";

describe("pickLogLevel", () => {
  // Row 1: production, no env var → info
  it("returns 'info' in production with no AGENTIC_HOOKS_DEBUG", () => {
    expect(pickLogLevel([], {})).toBe("info");
  });

  // Row 2: production, DEBUG=1 → debug
  it("returns 'debug' in production with AGENTIC_HOOKS_DEBUG=1", () => {
    expect(pickLogLevel([], { AGENTIC_HOOKS_DEBUG: "1" })).toBe("debug");
  });

  // Row 3: production, DEBUG=trace → trace
  it("returns 'trace' in production with AGENTIC_HOOKS_DEBUG=trace", () => {
    expect(pickLogLevel([], { AGENTIC_HOOKS_DEBUG: "trace" })).toBe("trace");
  });

  // Row 4: dev mode (--inspect with value), no env var → null (leave SDK seed)
  it("returns null in dev mode (--inspect=...) with no AGENTIC_HOOKS_DEBUG", () => {
    expect(pickLogLevel(["--inspect=127.0.0.1:9229"], {})).toBeNull();
  });

  // Row 5: dev mode, DEBUG=1 → null (env var is no-op in dev, SDK already debug)
  it("returns null in dev mode with AGENTIC_HOOKS_DEBUG=1", () => {
    expect(pickLogLevel(["--inspect"], { AGENTIC_HOOKS_DEBUG: "1" })).toBeNull();
  });

  // Row 6: dev mode, DEBUG=trace → trace (explicit upgrade path)
  it("returns 'trace' in dev mode with AGENTIC_HOOKS_DEBUG=trace", () => {
    expect(pickLogLevel(["--inspect-brk"], { AGENTIC_HOOKS_DEBUG: "trace" })).toBe("trace");
  });

  // Sanity: --inspect-port flag variant is also recognized
  it("recognizes --inspect-port as dev mode", () => {
    expect(pickLogLevel(["--inspect-port=9229"], {})).toBeNull();
  });
});
