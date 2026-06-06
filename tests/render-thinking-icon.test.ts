import { describe, it, expect } from "vitest";
import { renderThinkingIcon, THINKING_FRAMES } from "../src/render-thinking-icon.js";

function decodeDataUri(uri: string): string {
  const prefix = "data:image/svg+xml;base64,";
  if (!uri.startsWith(prefix)) throw new Error(`Not a data URI: ${uri.slice(0, 60)}`);
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf-8");
}

describe("renderThinkingIcon", () => {
  it("THINKING_FRAMES is the 8-frame pulse sequence", () => {
    expect(THINKING_FRAMES).toEqual(["·", "*", "✶", "✢", "✻", "✢", "✶", "*"]);
    expect(THINKING_FRAMES).toHaveLength(8);
  });

  it("returns a base64 data URI for each frame", () => {
    for (const frame of THINKING_FRAMES) {
      expect(renderThinkingIcon(frame).startsWith("data:image/svg+xml;base64,")).toBe(true);
    }
  });

  it("SVG contains the frame glyph as visible text", () => {
    for (const frame of THINKING_FRAMES) {
      const svg = decodeDataUri(renderThinkingIcon(frame));
      expect(svg).toContain(frame);
    }
  });

  it("SVG uses the coral color #da7756 for the glyph", () => {
    for (const frame of THINKING_FRAMES) {
      const svg = decodeDataUri(renderThinkingIcon(frame));
      expect(svg).toContain("#da7756");
    }
  });

  it("SVG has a black background (#000000)", () => {
    const svg = decodeDataUri(renderThinkingIcon("*"));
    expect(svg).toContain("#000000");
  });

  it("is deterministic — same frame produces byte-identical output", () => {
    for (const frame of THINKING_FRAMES) {
      expect(renderThinkingIcon(frame)).toBe(renderThinkingIcon(frame));
    }
  });

  it("different frames produce different output", () => {
    // Not all adjacent frames are different glyphs (✢ repeats at idx 3 and 5),
    // but the overall sequence has at least 5 unique glyphs.
    const unique = new Set(THINKING_FRAMES.map((f) => renderThinkingIcon(f)));
    expect(unique.size).toBeGreaterThanOrEqual(5);
  });
});
