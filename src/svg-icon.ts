// Shared SVG plumbing for the runtime-generated 144×144 key faces
// (render-count-icon, render-thinking-icon). Single source for the key-face
// geometry, background, and font stack so the two faces cannot drift apart.
// Pure functions; deterministic; no I/O.

export const SIZE = 144;
export const RADIUS = 20;
export const BG = "#000000";
export const FONT_FAMILY = `-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;

export function svgOpen(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`;
}

export function svgBg(): string {
  return `<rect width="${SIZE}" height="${SIZE}" rx="${RADIUS}" fill="${BG}"/>`;
}

export function toDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf-8").toString("base64")}`;
}
