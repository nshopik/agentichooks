import { describe, it, expect } from "vitest";
import { renderMoonIcon } from "../src/render-moon-icon.js";

function decode(dataUri: string): string {
  const b64 = dataUri.replace(/^data:image\/svg\+xml;base64,/, "");
  return Buffer.from(b64, "base64").toString("utf-8");
}

describe("renderMoonIcon", () => {
  it("returns a base64 SVG data URI", () => {
    expect(renderMoonIcon()).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("is deterministic", () => {
    expect(renderMoonIcon()).toBe(renderMoonIcon());
  });

  it("draws a crescent: an illuminated circle masked by a shadow circle", () => {
    const svg = decode(renderMoonIcon());
    expect(svg).toContain('<mask id="crescent">');
    // Two circles — the lit disc and the shadow bite — plus the mask reference.
    expect(svg.match(/<circle/g)).toHaveLength(2);
    expect(svg).toContain('mask="url(#crescent)"');
  });
});
