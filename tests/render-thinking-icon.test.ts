import { describe, it, expect } from "vitest";
import { renderThinkingIcon, THINKING_FRAMES } from "../src/render-thinking-icon.js";

function decodeDataUri(uri: string): string {
  const prefix = "data:image/svg+xml;base64,";
  if (!uri.startsWith(prefix)) throw new Error(`Not a data URI: ${uri.slice(0, 60)}`);
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf-8");
}

describe("renderThinkingIcon", () => {
  // ---- THINKING_FRAMES constant ----

  it("THINKING_FRAMES is the 8-frame pulse sequence", () => {
    expect(THINKING_FRAMES).toEqual(["·", "*", "✶", "✢", "✻", "✢", "✶", "*"]);
    expect(THINKING_FRAMES).toHaveLength(8);
  });

  // ---- Legacy: frame + null elapsed (centered big glyph, current layout) ----

  it("returns a base64 data URI for each frame when elapsed is null", () => {
    for (const frame of THINKING_FRAMES) {
      expect(renderThinkingIcon(frame, null).startsWith("data:image/svg+xml;base64,")).toBe(true);
    }
  });

  it("SVG contains the frame glyph as visible text (frame + null elapsed)", () => {
    for (const frame of THINKING_FRAMES) {
      const svg = decodeDataUri(renderThinkingIcon(frame, null));
      expect(svg).toContain(frame);
    }
  });

  it("SVG uses the coral color #da7756 for the glyph (frame + null elapsed)", () => {
    for (const frame of THINKING_FRAMES) {
      const svg = decodeDataUri(renderThinkingIcon(frame, null));
      expect(svg).toContain("#da7756");
    }
  });

  it("SVG has a black background (#000000) for all layouts", () => {
    const svg = decodeDataUri(renderThinkingIcon("*", null));
    expect(svg).toContain("#000000");
  });

  it("is deterministic — same args produce byte-identical output", () => {
    for (const frame of THINKING_FRAMES) {
      expect(renderThinkingIcon(frame, null)).toBe(renderThinkingIcon(frame, null));
      expect(renderThinkingIcon(frame, "1:23")).toBe(renderThinkingIcon(frame, "1:23"));
    }
  });

  it("different frames produce different output (frame + null elapsed)", () => {
    const unique = new Set(THINKING_FRAMES.map((f) => renderThinkingIcon(f, null)));
    expect(unique.size).toBeGreaterThanOrEqual(5);
  });

  // ---- Sparkle + timer layout (frame + elapsed) ----

  it("sparkle + timer: SVG contains both the frame glyph and the elapsed label", () => {
    const svg = decodeDataUri(renderThinkingIcon("✶", "4:37"));
    expect(svg).toContain("✶");
    expect(svg).toContain("4:37");
  });

  it("sparkle + timer: elapsed label uses gray color #9a9a9a", () => {
    const svg = decodeDataUri(renderThinkingIcon("*", "35s"));
    expect(svg).toContain("#9a9a9a");
  });

  it("sparkle + timer: coral sparkle #da7756 still present", () => {
    const svg = decodeDataUri(renderThinkingIcon("*", "35s"));
    expect(svg).toContain("#da7756");
  });

  it("sparkle + timer: sparkle text element appears before the timer text element in SVG source", () => {
    const svg = decodeDataUri(renderThinkingIcon("✶", "35s"));
    const sparkleIdx = svg.indexOf("#da7756");
    const timerIdx = svg.indexOf("#9a9a9a");
    expect(sparkleIdx).toBeGreaterThan(-1);
    expect(timerIdx).toBeGreaterThan(-1);
    expect(sparkleIdx).toBeLessThan(timerIdx);
  });

  it("sparkle matches the historical corner-glyph geometry (x=22 y=34, centered, font-size 33)", () => {
    // Pinned to the pre-#38 render-count-icon corner glyph (commit b7f21a5):
    // <text x="22" y="34" text-anchor="middle" ... font-size="33">. Restored
    // after user feedback that the 26px sparkle read smaller than it used to.
    const svg = decodeDataUri(renderThinkingIcon("*", "35s"));
    expect(svg).toContain(`x="22" y="34" text-anchor="middle"`);
    expect(svg).toMatch(/font-size="33"[^>]*fill="#da7756"/);
  });

  // ---- Timer-only layout (null frame + elapsed) ----

  it("timer-only: SVG contains the elapsed label", () => {
    const svg = decodeDataUri(renderThinkingIcon(null, "59s"));
    expect(svg).toContain("59s");
  });

  it("timer-only: elapsed label uses gray color #9a9a9a", () => {
    const svg = decodeDataUri(renderThinkingIcon(null, "2:00"));
    expect(svg).toContain("#9a9a9a");
  });

  it("timer-only: coral color #da7756 is ABSENT (no sparkle element)", () => {
    const svg = decodeDataUri(renderThinkingIcon(null, "2:00"));
    expect(svg).not.toContain("#da7756");
  });

  it("timer-only: SVG does not contain an empty text element", () => {
    const svg = decodeDataUri(renderThinkingIcon(null, "2:00"));
    expect(svg).not.toMatch(/<text[^>]*><\/text>/);
  });

  it("timer-only: returns a valid data URI", () => {
    expect(renderThinkingIcon(null, "1:23").startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  // ---- Small font for labels with length >= 7 ----

  it("uses smaller font size when elapsed label length >= 7 (h:mm:ss tier)", () => {
    const svgShort = decodeDataUri(renderThinkingIcon("*", "9:59"));   // length 4 → large
    const svgLong  = decodeDataUri(renderThinkingIcon("*", "1:00:00")); // length 7 → smaller
    const extractTimerFontSize = (svg: string): number => {
      const match = svg.match(/font-size="([^"]+)" font-weight="700" fill="#9a9a9a"/);
      return Number(match?.[1] ?? "0");
    };
    const shortSize = extractTimerFontSize(svgShort);
    const longSize  = extractTimerFontSize(svgLong);
    expect(shortSize).toBeGreaterThan(0);
    expect(longSize).toBeGreaterThan(0);
    expect(shortSize).toBeGreaterThan(longSize);
  });

  it("5-char label uses the large font; 7-char label uses the smaller font", () => {
    const svgFive  = decodeDataUri(renderThinkingIcon("*", "59:59"));   // length 5
    const svgSeven = decodeDataUri(renderThinkingIcon("*", "9:59:59")); // length 7
    const extractTimerFontSize = (svg: string): number => {
      const match = svg.match(/font-size="([^"]+)" font-weight="700" fill="#9a9a9a"/);
      return Number(match?.[1] ?? "0");
    };
    expect(extractTimerFontSize(svgFive)).toBeGreaterThan(extractTimerFontSize(svgSeven));
  });

  // ---- Timer baseline: pinned vertical centering ----
  // These pins ensure a vertical-centering regression (e.g. dropping the `timerFontSize * 0.35`
  // term and using SIZE/2 alone) is caught. Same class of regression guard as the pill-geometry
  // pin in render-count-icon tests. The regex anchors on the timer element's gray fill so it
  // cannot accidentally match the sparkle text element (coral #da7756, x=22 y=34).

  it("large font tier (length < 7): timer text is at x=72 and y=SIZE/2 + 44*0.35", () => {
    // "35s" has length 3 → TIMER_FONT_SIZE_LARGE = 44
    const svg = decodeDataUri(renderThinkingIcon("*", "35s"));
    const match = svg.match(/<text x="([^"]+)" y="([^"]+)" text-anchor="middle" [^>]*fill="#9a9a9a"/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("72");
    const expectedY = 144 / 2 + 44 * 0.35;
    expect(Number(match![2])).toBeCloseTo(expectedY, 10);
  });

  it("small font tier (length >= 7): timer text is at x=72 and y=SIZE/2 + 30*0.35", () => {
    // "1:00:00" has length 7 → TIMER_FONT_SIZE_SMALL = 30
    const svg = decodeDataUri(renderThinkingIcon(null, "1:00:00"));
    const match = svg.match(/<text x="([^"]+)" y="([^"]+)" text-anchor="middle" [^>]*fill="#9a9a9a"/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("72");
    const expectedY = 144 / 2 + 30 * 0.35;
    expect(Number(match![2])).toBeCloseTo(expectedY, 10);
  });

  // ---- null + null: total function, valid plain black rounded square ----

  it("null frame + null elapsed returns a valid data URI (total function)", () => {
    expect(renderThinkingIcon(null, null).startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("null + null: SVG has black background but no coral and no gray timer text", () => {
    const svg = decodeDataUri(renderThinkingIcon(null, null));
    expect(svg).toContain("#000000");
    expect(svg).not.toContain("#da7756");
    expect(svg).not.toContain("#9a9a9a");
  });

  it("null + null: SVG contains no text elements", () => {
    const svg = decodeDataUri(renderThinkingIcon(null, null));
    expect(svg).not.toContain("<text");
  });
});
