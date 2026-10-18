// Runtime-generated SVG icon for the Task Completed key.
// Shows a big number (yellow task count, or coral subagent count when the
// task count is hidden) and an optional coral subagent-count pill
// (top-right corner, shown when agentCount > 0).
// Sparkle and frame param are removed — animation moves to On Stop.
// Pure function; deterministic; no I/O.
//
// SVG element order (pinned for test stability):
//   1. Background <rect>
//   2. Big-number <text>   ← first font-size match
//   3. Pill <circle> or <rect> (when agentCount > 0)
//   4. Pill numeral <text>

import { SIZE, FONT_FAMILY, svgOpen, svgBg, toDataUri } from "./svg-icon.js";

const FG = "#fde047";          // task number
const PILL_COLOR = "#da7756";  // coral pill
const PILL_TEXT = "#000000";

const FONT_SIZE_1_DIGIT = 96;
const FONT_SIZE_2_DIGIT = 72;
const FONT_SIZE_OVERFLOW = 56;
const PILL_FONT_SIZE = 24;

// Pill geometry (top-right corner)
const PILL_CX = 118;   // horizontal center
const PILL_CY = 26;    // vertical center
const PILL_R = 19;     // circle radius (1 digit)
// Capsule: rounded rect, centered at (PILL_CX, PILL_CY)
const CAPSULE_W = 50;
const CAPSULE_H = 38;
const CAPSULE_RX = 19;

function pickDisplay(count: number): { display: string; fontSize: number } {
  if (count >= 100) return { display: "99+", fontSize: FONT_SIZE_OVERFLOW };
  if (count >= 10) return { display: String(count), fontSize: FONT_SIZE_2_DIGIT };
  return { display: String(count), fontSize: FONT_SIZE_1_DIGIT };
}

function buildPill(agentCount: number): string {
  if (agentCount <= 0) return "";
  const display = agentCount >= 100 ? "99" : String(agentCount);
  const twoDigit = display.length >= 2;
  const shape = twoDigit
    ? `<rect x="${PILL_CX - CAPSULE_W / 2}" y="${PILL_CY - CAPSULE_H / 2}" width="${CAPSULE_W}" height="${CAPSULE_H}" rx="${CAPSULE_RX}" fill="${PILL_COLOR}"/>`
    : `<circle cx="${PILL_CX}" cy="${PILL_CY}" r="${PILL_R}" fill="${PILL_COLOR}"/>`;
  const text = `<text x="${PILL_CX}" y="${PILL_CY + PILL_FONT_SIZE * 0.35}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${PILL_FONT_SIZE}" font-weight="700" fill="${PILL_TEXT}">${display}</text>`;
  return shape + text;
}

function buildSvg(display: string, fontSize: number, fill: string, pillSvg: string): string {
  return [
    svgOpen(),
    svgBg(),
    `<text x="${SIZE / 2}" y="${SIZE / 2 + fontSize * 0.35}" text-anchor="middle" `,
    `font-family="${FONT_FAMILY}" `,
    `font-size="${fontSize}" font-weight="700" fill="${fill}">${display}</text>`,
    pillSvg,
    `</svg>`,
  ].join("");
}

export function renderCountIcon(count: number, agentCount: number, fill: string = FG): string {
  const { display, fontSize } = pickDisplay(count);
  const pillSvg = buildPill(agentCount);
  return toDataUri(buildSvg(display, fontSize, fill, pillSvg));
}

// Task Completed key image. Without showTaskCount the big number is the
// subagent count in the pill's coral and there is no pill. "" means idle: the caller clears the
// state-0 override so the manifest/user image shows.
export function renderTaskKeyIcon(taskSum: number, agentSum: number, showTaskCount: boolean): string {
  if (!showTaskCount) return agentSum > 0 ? renderCountIcon(agentSum, 0, PILL_COLOR) : "";
  return taskSum > 0 || agentSum > 0 ? renderCountIcon(taskSum, agentSum) : "";
}
