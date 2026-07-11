import { describe, it, expect } from "vitest";
import { renderCountIcon } from "../src/render-count-icon.js";

function decodeDataUri(uri: string): string {
  const prefix = "data:image/svg+xml;base64,";
  if (!uri.startsWith(prefix)) throw new Error(`Expected data URI, got: ${uri.slice(0, 60)}`);
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf-8");
}

describe("renderCountIcon(taskCount, agentCount)", () => {
  // ---- Basic output shape ----

  it("returns a base64 data URI with the SVG mime type", () => {
    expect(renderCountIcon(7, 0).startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  it("decoded SVG contains the task count as visible text", () => {
    const svg = decodeDataUri(renderCountIcon(7, 0));
    expect(svg).toMatch(/>7<\/text>/);
  });

  it("renders 99+ for task counts >= 100", () => {
    expect(decodeDataUri(renderCountIcon(100, 0))).toMatch(/>99\+<\/text>/);
    expect(decodeDataUri(renderCountIcon(999, 0))).toMatch(/>99\+<\/text>/);
  });

  // ---- Font-size scaling: extracts FIRST font-size which is the task number ----

  it("font-size shrinks across thresholds: 1-digit > 2-digit > 99+", () => {
    // Anchored on the task fill (#fde047) so extraction is order-independent —
    // the task <text> element emits font-size before fill in the same tag.
    const fontSize = (svg: string): number => {
      const m = svg.match(/font-size="(\d+)"[^>]*fill="#fde047"/);
      expect(m).not.toBeNull();
      return Number(m![1]);
    };
    const oneDigit = fontSize(decodeDataUri(renderCountIcon(7, 0)));
    const twoDigit = fontSize(decodeDataUri(renderCountIcon(42, 0)));
    const cap = fontSize(decodeDataUri(renderCountIcon(150, 0)));
    expect(oneDigit).toBeGreaterThan(twoDigit);
    expect(twoDigit).toBeGreaterThan(cap);

    // Sanity: with a pill present (agentCount > 0), the extracted font-size is
    // still the task number, not the smaller pill numeral font (~24px).
    expect(fontSize(decodeDataUri(renderCountIcon(7, 3)))).toBeGreaterThanOrEqual(56);
  });

  // ---- Determinism ----

  it("is deterministic — same inputs produce byte-identical output", () => {
    expect(renderCountIcon(13, 0)).toBe(renderCountIcon(13, 0));
    expect(renderCountIcon(5, 3)).toBe(renderCountIcon(5, 3));
  });

  // ---- Pill: absent when agentCount = 0 ----

  it("pill is absent when agentCount = 0", () => {
    const svg = decodeDataUri(renderCountIcon(5, 0));
    // Pill is a <rect> or <circle> with the coral fill — absent when 0
    expect(svg).not.toContain("#da7756");
  });

  // ---- Pill: circle for 1 agent ----

  it("pill is a circle when agentCount = 1", () => {
    const svg = decodeDataUri(renderCountIcon(3, 1));
    expect(svg).toContain("#da7756");
    expect(svg).toMatch(/<circle/);
    expect(svg).toMatch(/>1<\/text>/);
  });

  // ---- Zero tasks with live subagents: center "0" + pill ----
  // Guards the broadcastCounts / onWillAppear gate that renders whenever
  // taskCount > 0 OR agentCount > 0. A lone subagent (taskCount = 0) must still
  // paint its pill; the center shows a big "0".

  it("renders a big '0' center and the coral pill when taskCount = 0 and agentCount > 0", () => {
    const svg = decodeDataUri(renderCountIcon(0, 2));
    expect(svg).toMatch(/>0<\/text>/);   // task number is a visible "0"
    expect(svg).toContain("#da7756");      // coral pill present
    expect(svg).toMatch(/>2<\/text>/);     // pill shows the subagent count
  });

  // ---- Pill shape boundary: circle at 1 digit, capsule at 2 ----
  // The shape switches on the DISPLAYED digit count, not the raw agentCount:
  // agentCount 9 → "9" → circle; 10 → "10" → capsule.

  it("pill is a circle when the agent count is a single digit (agentCount = 9)", () => {
    const svg = decodeDataUri(renderCountIcon(3, 9));
    expect(svg).toMatch(/<circle[^>]*fill="#da7756"/);
    expect(svg).toMatch(/>9<\/text>/);
  });

  it("pill is a coral capsule (rounded rect) when the agent count is two digits (agentCount = 10)", () => {
    const svg = decodeDataUri(renderCountIcon(1, 10));
    // The coral fill distinguishes the capsule from the background <rect>,
    // which the old /<rect[^>]*rx=/ regex matched vacuously.
    expect(svg).toMatch(/<rect[^>]*rx="\d+"[^>]*fill="#da7756"/);
    expect(svg).toMatch(/>10<\/text>/);
  });

  // ---- Pill: agent count caps at 99 ----

  it("agent count caps at 99 in the pill (renders '99' for 99+)", () => {
    const svg99 = decodeDataUri(renderCountIcon(1, 99));
    const svg100 = decodeDataUri(renderCountIcon(1, 100));
    expect(svg99).toMatch(/>99<\/text>/);
    // At 100+, pill shows "99" (capped, no + needed — pill is notification style)
    expect(svg100).toMatch(/>99<\/text>/);
  });

  // ---- Pill geometry: pinned to top-right corner ----
  // Without these, a wrong-corner regression (e.g. cx="26" cy="118") would pass
  // all shape/order checks above but still be visually broken.

  it("circle pill (agentCount = 1) is positioned in the top-right quadrant", () => {
    const svg = decodeDataUri(renderCountIcon(3, 1));
    // Match the coral <circle> specifically to avoid confusing it with other elements
    const m = svg.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="[\d.]+" fill="#da7756"\/>/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(72);
    expect(Number(m![2])).toBeLessThan(72);
  });

  it("capsule pill (agentCount = 10) rect is positioned in the top-right quadrant", () => {
    // agentCount = 10 → display "10" (2 digits) → capsule rect shape
    const svg = decodeDataUri(renderCountIcon(3, 10));
    const m = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="[\d.]+" rx="(\d+)" fill="#da7756"\/>/);
    expect(m).not.toBeNull();
    const [, x, y, width, rx] = m!;
    expect(Number(x) + Number(width) / 2).toBeGreaterThan(72);
    expect(Number(y)).toBeLessThan(72);
    expect(Number(rx)).toBeGreaterThan(0); // rounded corners (capsule, not sharp rect)
  });

  it("pill <text> is horizontally centered on the pill (x=118, text-anchor=middle)", () => {
    const svg = decodeDataUri(renderCountIcon(3, 1));
    // Pin horizontal centering only; the exact baseline y is an implementation
    // detail. The old test recomputed y with the source's own expression, so it
    // could never disagree with the source.
    expect(svg).toMatch(/<text x="118" y="[\d.]+" text-anchor="middle"/);
  });
});
