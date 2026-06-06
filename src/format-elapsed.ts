// Pure elapsed-time formatter for the On Stop timer display.
// Four format tiers, per spec decision 3:
//   < 60 s      → "Ns"       (e.g. "35s")
//   < 1 h       → "m:ss"     (e.g. "4:37", "59:59")  — ss zero-padded
//   < 10 h      → "h:mm:ss"  (e.g. "1:04:52")        — mm and ss zero-padded
//   ≥ 10 h      → "hh:mm"    (e.g. "10:00", "10:04") — mm zero-padded; seconds dropped
//
// Negative input is clamped to 0 (defensive; cannot occur with a monotonic wall clock).
// Font-size selection (label.length >= 7 → smaller font) lives in the renderer, not here.
export function formatElapsed(ms: number): string {
  // Clamp negatives before any arithmetic.
  const safe = Math.max(0, ms);

  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours === 0 && minutes === 0) {
    // Seconds tier
    return `${seconds}s`;
  }

  if (hours === 0) {
    // Minutes tier: m:ss
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  if (hours < 10) {
    // Hours < 10 tier: h:mm:ss
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  // Hours >= 10 tier: hh:mm (seconds dropped)
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}
