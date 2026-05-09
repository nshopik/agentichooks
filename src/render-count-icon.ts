// Runtime-generated SVG icon for the in-flight Task Completed visual.
// Output: data:image/svg+xml;base64,<base64> — fed straight to
// KeyAction.setImage(uri, 0). Pure function; deterministic; no I/O.
//
// Visual: 144×144 rounded black square (manifest @2x dimensions), big white
// centered number, small white clock outline glyph in the upper-left corner
// so the button's identity is preserved while the count dominates the face.
// Counts ≥ 100 cap to "99+". Background is pure black (not the slate that
// the manifest's idle/alert images use) — the in-flight state is meant to
// read as visually distinct from the resting clock.

const SIZE = 144;
const RADIUS = 20;
const BG = "#000000";
const FG = "#ffffff";

// Font sizes tuned by inspection on a real Stream Deck XL key. 1-digit is
// "as big as it'll go without crowding the corner clock"; 2-digit shrinks
// to clear neighbours; 99+ shrinks again so three glyphs fit.
const FONT_SIZE_1_DIGIT = 96;
const FONT_SIZE_2_DIGIT = 72;
const FONT_SIZE_OVERFLOW = 56;

function pickDisplay(count: number): { display: string; fontSize: number } {
  if (count >= 100) return { display: "99+", fontSize: FONT_SIZE_OVERFLOW };
  if (count >= 10) return { display: String(count), fontSize: FONT_SIZE_2_DIGIT };
  return { display: String(count), fontSize: FONT_SIZE_1_DIGIT };
}

function buildSvg(display: string, fontSize: number): string {
  // Joined with no whitespace so output is byte-stable across runs.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${BG}"/>`,
    // Corner clock — circle + minute hand up + hour hand to ~3 o'clock.
    // Centered at (22,22) with r=11, matching the project's existing clock
    // proportions (Draw-IdleGlyph in scripts/gen-icons.ps1).
    `<g stroke="${FG}" stroke-width="3" stroke-linecap="round" fill="none">`,
    `<circle cx="22" cy="22" r="11"/>`,
    `<line x1="22" y1="22" x2="22" y2="15"/>`,
    `<line x1="22" y1="22" x2="28" y2="22"/>`,
    `</g>`,
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

export function renderCountIcon(count: number): string {
  const { display, fontSize } = pickDisplay(count);
  const svg = buildSvg(display, fontSize);
  const base64 = Buffer.from(svg, "utf-8").toString("base64");
  return `data:image/svg+xml;base64,${base64}`;
}
