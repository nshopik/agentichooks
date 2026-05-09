import { describe, it, expect } from "vitest";
import { renderCountIcon } from "../src/render-count-icon.js";

function decodeDataUri(uri: string): string {
  const prefix = "data:image/svg+xml;base64,";
  expect(uri.startsWith(prefix)).toBe(true);
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf-8");
}

describe("renderCountIcon", () => {
  it("returns a base64 data URI with the SVG mime type", () => {
    const uri = renderCountIcon(7);
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("decoded SVG contains the count as visible text content", () => {
    const svg = decodeDataUri(renderCountIcon(7));
    expect(svg).toMatch(/>7<\/text>/);
  });

  it("decoded SVG renders 99+ for counts >= 100", () => {
    const svg100 = decodeDataUri(renderCountIcon(100));
    const svg999 = decodeDataUri(renderCountIcon(999));
    expect(svg100).toMatch(/>99\+<\/text>/);
    expect(svg999).toMatch(/>99\+<\/text>/);
  });

  it("font-size shrinks across thresholds: 1-digit > 2-digit > 99+", () => {
    const fontSize = (svg: string): number => {
      const m = svg.match(/font-size="(\d+)"/);
      expect(m).not.toBeNull();
      return Number(m![1]);
    };
    const oneDigit = fontSize(decodeDataUri(renderCountIcon(7)));
    const twoDigit = fontSize(decodeDataUri(renderCountIcon(42)));
    const cap = fontSize(decodeDataUri(renderCountIcon(150)));
    expect(oneDigit).toBeGreaterThan(twoDigit);
    expect(twoDigit).toBeGreaterThan(cap);
  });

  it("is deterministic — same input produces byte-identical output", () => {
    const a = renderCountIcon(13);
    const b = renderCountIcon(13);
    expect(a).toBe(b);
  });
});
