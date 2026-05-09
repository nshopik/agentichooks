// Runtime-generated SVG icon for the in-flight Task Completed visual.
// Output: data:image/svg+xml;base64,<base64> — fed straight to
// KeyAction.setImage(uri, 0). Pure function; deterministic; no I/O.
//
// Visual: 144×144 rounded black square (manifest @2x dimensions), big yellow
// centered number, corner glyph switches on the optional `frame` param:
//   no frame  → static yellow sparkle polygon (✦ shape)
//   frame set → coral Unicode character (caller supplies animation frames)
// Counts ≥ 100 cap to "99+".

const SIZE = 144;
const RADIUS = 20;
const BG = "#000000";
const FG = "#facc15";          // number + static sparkle
const GLYPH_COLOR = "#da7756"; // coral — animated frame glyphs

// Font sizes tuned by inspection on a real Stream Deck XL key. 1-digit is
// "as big as it'll go without crowding the corner glyph"; 2-digit shrinks
// to clear neighbours; 99+ shrinks again so three glyphs fit.
const FONT_SIZE_1_DIGIT = 96;
const FONT_SIZE_2_DIGIT = 72;
const FONT_SIZE_OVERFLOW = 56;

function pickDisplay(count: number): { display: string; fontSize: number } {
  if (count >= 100) return { display: "99+", fontSize: FONT_SIZE_OVERFLOW };
  if (count >= 10) return { display: String(count), fontSize: FONT_SIZE_2_DIGIT };
  return { display: String(count), fontSize: FONT_SIZE_1_DIGIT };
}

function buildSvg(display: string, fontSize: number, frame?: string): string {
  // Joined with no whitespace so output is byte-stable across runs.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${BG}"/>`,
    // Corner glyph: animated Unicode frame (coral) or static sparkle polygon (yellow)
    frame
      ? `<text x="22" y="31" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="22" font-weight="700" fill="${GLYPH_COLOR}">${frame}</text>`
      : `<polygon points="22,8.25 24.65,19.35 35.75,22 24.65,24.65 22,35.75 19.35,24.65 8.25,22 19.35,19.35" fill="${FG}"/>`,
    // y is the alphabetic baseline (Stream Deck's SVG renderer ignores
    // dominant-baseline AND dy, so we compute the baseline explicitly).
    // For a digit with cap-height ≈ 0.7×fontSize, baseline at SIZE/2 + 0.35×fontSize
    // puts the cap height visually centered on y=SIZE/2.
    `<text x="${SIZE / 2}" y="${SIZE / 2 + fontSize * 0.35}" text-anchor="middle" `,
    `font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" `,
    `font-size="${fontSize}" font-weight="700" fill="${FG}">${display}</text>`,
    `</svg>`,
  ].join("");
}

export function renderCountIcon(count: number, frame?: string): string {
  const { display, fontSize } = pickDisplay(count);
  const svg = buildSvg(display, fontSize, frame);
  const base64 = Buffer.from(svg, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}
