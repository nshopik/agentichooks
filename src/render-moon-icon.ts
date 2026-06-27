// Runtime-generated SVG crescent for the On Stop key's "waiting on subagents"
// state: the main turn ended but subagents are still running, so the Stop chime
// is held (see Dispatcher.suppressStop). Painted on state 0, beneath the armed
// alert image — when the deferred Stop finally fires, the green-check state-1
// image takes over.
//
// The crescent is the brand "moon" from gen-icons.ps1 (Draw-MoonGlyph): two
// same-radius circles offset horizontally; the illuminated circle masked by the
// shadow circle yields the left-lit crescent. Muted slate fill reads as dormant.
//
// Pure function; deterministic; no I/O.

const SIZE = 144;
const RADIUS = 20;
const BG = "#000000";
const MOON_COLOR = "#9aa0a6"; // muted slate — "dormant / waiting"

// Geometry mirrors Draw-MoonGlyph (fractions of SIZE): R=0.30, gap d=0.20,
// illuminated center at 0.40, shadow center at 0.60, vertically centered.
const R = SIZE * 0.3;
const CY = SIZE * 0.5;
const CX_LIT = SIZE * 0.4;
const CX_SHADOW = SIZE * 0.6;

function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}

export function renderMoonIcon(): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
    `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${BG}"/>`,
    // The shadow circle (black on the white mask) bites the right side of the
    // illuminated circle, leaving the left-lit crescent.
    `<mask id="crescent">`,
    `<rect width="${SIZE}" height="${SIZE}" fill="white"/>`,
    `<circle cx="${CX_SHADOW}" cy="${CY}" r="${R}" fill="black"/>`,
    `</mask>`,
    `<circle cx="${CX_LIT}" cy="${CY}" r="${R}" fill="${MOON_COLOR}" mask="url(#crescent)"/>`,
    `</svg>`,
  ].join("");
  return toDataUri(svg);
}
