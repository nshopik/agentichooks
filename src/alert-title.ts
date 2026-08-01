/**
 * Last path segment of `p`, split on both '/' and '\' with empty segments
 * dropped. A bare drive designator ("C:") is a root, not a name, so it yields
 * "". Shared with the HTTP listener's cwd log field.
 */
export function basename(p: string): string {
  const last = p.split(/[/\\]/).filter((s) => s.length > 0).at(-1) ?? "";
  return /^[A-Za-z]:$/.test(last) ? "" : last;
}

/**
 * Formats a Stream Deck key title for armed stop/permission alerts.
 *
 * Returns the basename of latestCwd (split on both '/' and '\', drop empty segments)
 * with a '\n+N' second line when count > 1 (N = count - 1: one session shown by
 * name, N others). Falls back gracefully: null/empty/root-only cwd → basename
 * omitted. No truncation in v1 — Stream Deck auto-shrinks title font.
 *
 * @param count  Number of armed sessions for this event type.
 * @param latestCwd  cwd of the most-recently-armed session, or null.
 * @returns  Key title string, empty string when nothing meaningful to show.
 */
export function formatAlertTitle(count: number, latestCwd: string | null): string {
  const name = basename(latestCwd ?? "");

  const parts: string[] = [];
  if (name) parts.push(name);
  if (count > 1) parts.push(`+${count - 1}`);

  return parts.join("\n");
}
