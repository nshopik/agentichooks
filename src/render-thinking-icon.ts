// Runtime-generated SVG icon for the On Stop "thinking" indicator.
// 8-frame pulse sequence at large centered size on a black rounded square.
// The sparkle motif lives on here as the pulse's resting frames.
// Pure function; deterministic; no I/O.

const SIZE = 144;
const RADIUS = 20;
const BG = "#000000";
const GLYPH_COLOR = "#da7756"; // coral
const GLYPH_FONT_SIZE = 80;

export const THINKING_FRAMES = ["·", "*", "✶", "✢", "✻", "✢", "✶", "*"] as const;
export type ThinkingFrame = (typeof THINKING_FRAMES)[number];

function buildSvg(frame: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${BG}"/>`,
    `<text x="${SIZE / 2}" y="${SIZE / 2 + GLYPH_FONT_SIZE * 0.35}" text-anchor="middle" `,
    `font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" `,
    `font-size="${GLYPH_FONT_SIZE}" font-weight="700" fill="${GLYPH_COLOR}">${frame}</text>`,
    `</svg>`,
  ].join("");
}

export function renderThinkingIcon(frame: string): string {
  const svg = buildSvg(frame);
  const base64 = Buffer.from(svg, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}
