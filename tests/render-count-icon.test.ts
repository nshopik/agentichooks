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
    // SVG element order: bg rect, task-count <text>, pill elements last.
    // The first font-size match must be the task number, not the pill numeral.
    const fontSize = (svg: string): number => {
      const m = svg.match(/font-size="(\d+)"/);
      expect(m).not.toBeNull();
      return Number(m![1]);
    };
    const oneDigit = fontSize(decodeDataUri(renderCountIcon(7, 0)));
    const twoDigit = fontSize(decodeDataUri(renderCountIcon(42, 0)));
    const cap = fontSize(decodeDataUri(renderCountIcon(150, 0)));
    expect(oneDigit).toBeGreaterThan(twoDigit);
    expect(twoDigit).toBeGreaterThan(cap);
  });

  // ---- Determinism ----

  it("is deterministic — same inputs produce byte-identical output", () => {
    expect(renderCountIcon(13, 0)).toBe(renderCountIcon(13, 0));
    expect(renderCountIcon(5, 3)).toBe(renderCountIcon(5, 3));
  });

  // ---- No sparkle — verify removal ----

  it("does not contain a sparkle polygon element", () => {
    const svg = decodeDataUri(renderCountIcon(3, 0));
    expect(svg).not.toContain("<polygon");
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

  // ---- Pill: capsule for 2+ agents ----

  it("pill is a capsule (rect) when agentCount = 2", () => {
    const svg = decodeDataUri(renderCountIcon(3, 2));
    expect(svg).toContain("#da7756");
    // Capsule is a <rect> with rx attribute
    expect(svg).toMatch(/<rect[^>]*rx=/);
    expect(svg).toMatch(/>2<\/text>/);
  });

  it("pill is a capsule when agentCount = 10", () => {
    const svg = decodeDataUri(renderCountIcon(1, 10));
    expect(svg).toMatch(/<rect[^>]*rx=/);
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

  // ---- SVG element order: task text before pill ----

  it("task-count <text> appears before pill elements in SVG source (element order pin)", () => {
    const svg = decodeDataUri(renderCountIcon(5, 3));
    const taskTextIdx = svg.indexOf(`>5</text>`);
    const pillIdx = svg.indexOf("#da7756");
    expect(taskTextIdx).toBeGreaterThan(0);
    expect(pillIdx).toBeGreaterThan(taskTextIdx);
  });

  // ---- font-size first match is task number, not pill numeral ----

  it("first font-size in SVG is the task number font, not the pill numeral font", () => {
    // Pill numeral is small (~24px); task numbers are 56–96px.
    const svg = decodeDataUri(renderCountIcon(7, 3)); // 1-digit → 96px task font
    const m = svg.match(/font-size="(\d+)"/);
    expect(m).not.toBeNull();
    const first = Number(m![1]);
    expect(first).toBeGreaterThanOrEqual(56); // task number sizes: 96, 72, 56
  });
});
