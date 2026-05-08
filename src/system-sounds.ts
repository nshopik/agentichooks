import path from "node:path";
import type { EventType } from "./types.js";

const FILENAMES: Partial<Record<EventType, string>> = {
  stop: "Speech On.wav",
  permission: "Windows Message Nudge.wav",
  "task-completed": "Windows Notify System Generic.wav",
  // idle has no default sound — use the per-button audio config to set one.
};

export function defaultSoundPath(event: EventType): string | undefined {
  const filename = FILENAMES[event];
  if (!filename) return undefined;
  const root = process.env.SystemRoot ?? "C:\\Windows";
  return path.win32.join(root, "Media", filename);
}
