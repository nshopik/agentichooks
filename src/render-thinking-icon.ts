// Runtime-generated SVG icon for the On Stop key.
// Supports four layout modes based on the (frame, elapsed) argument pair:
//
//   frame + elapsed  → corner sparkle (top-left, coral #da7756, ~26px) +
//                      centered gray (#9a9a9a) elapsed timer
//   null  + elapsed  → centered gray elapsed timer only (animateThinking unchecked)
//   frame + null     → legacy centered big glyph layout (defensive fallback;
//                      unreachable in production per TurnClock invariant)
//   null  + null     → plain black rounded square (total function; callers
//                      typically call setImage("", 0) instead, but renderer
//                      must never throw)
//
// Pure function; deterministic; no I/O.

const SIZE = 144;
const RADIUS = 20;
const BG = "#000000";
const GLYPH_COLOR = "#da7756";     // coral — sparkle / legacy centered glyph
const TIMER_COLOR = "#9a9a9a";     // gray  — elapsed timer
const GLYPH_FONT_SIZE = 80;        // legacy centered glyph (frame + null)
const SPARKLE_FONT_SIZE = 26;      // corner sparkle (frame + elapsed)
const SPARKLE_X = 18;              // top-left corner x
const SPARKLE_Y = 34;              // top-left corner y (baseline)
const TIMER_FONT_SIZE_LARGE = 44;  // elapsed labels with length < 7
const TIMER_FONT_SIZE_SMALL = 30;  // elapsed labels with length >= 7 (h:mm:ss tier)

export const THINKING_FRAMES = ["·", "*", "✶", "✢", "✻", "✢", "✶", "*"] as const;
export type ThinkingFrame = (typeof THINKING_FRAMES)[number];

const FONT_FAMILY = `-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;

function svgOpen(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`;
}

function svgBg(): string {
  return `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${BG}"/>`;
}

function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

function timerText(elapsed: string): string {
  const timerFontSize = elapsed.length >= 7 ? TIMER_FONT_SIZE_SMALL : TIMER_FONT_SIZE_LARGE;
  const timerY = SIZE / 2 + timerFontSize * 0.35;
  return [
    `<text x="${SIZE / 2}" y="${timerY}" text-anchor="middle" `,
    `font-family="${FONT_FAMILY}" `,
    `font-size="${timerFontSize}" font-weight="700" fill="${TIMER_COLOR}">${elapsed}</text>`,
  ].join("");
}

export function renderThinkingIcon(frame: ThinkingFrame | null, elapsed: string | null): string {
  if (frame !== null && elapsed !== null) {
    // Layout: corner sparkle + centered gray timer.
    const svg = [
      svgOpen(),
      svgBg(),
      `<text x="${SPARKLE_X}" y="${SPARKLE_Y}" `,
      `font-family="${FONT_FAMILY}" `,
      `font-size="${SPARKLE_FONT_SIZE}" font-weight="700" fill="${GLYPH_COLOR}">${frame}</text>`,
      timerText(elapsed),
      `</svg>`,
    ].join("");
    return toDataUri(svg);
  }

  if (frame === null && elapsed !== null) {
    // Layout: timer only — no sparkle element at all.
    const svg = [svgOpen(), svgBg(), timerText(elapsed), `</svg>`].join("");
    return toDataUri(svg);
  }

  if (frame !== null && elapsed === null) {
    // Legacy layout: centered big glyph (unchanged from original implementation).
    const svg = [
      svgOpen(),
      svgBg(),
      `<text x="${SIZE / 2}" y="${SIZE / 2 + GLYPH_FONT_SIZE * 0.35}" text-anchor="middle" `,
      `font-family="${FONT_FAMILY}" `,
      `font-size="${GLYPH_FONT_SIZE}" font-weight="700" fill="${GLYPH_COLOR}">${frame}</text>`,
      `</svg>`,
    ].join("");
    return toDataUri(svg);
  }

  // null + null: plain black rounded square (total function).
  const svg = [svgOpen(), svgBg(), `</svg>`].join("");
  return toDataUri(svg);
}
