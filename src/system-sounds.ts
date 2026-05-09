import path from "node:path";
import type { EventType } from "./types.js";

const FILENAMES: Partial<Record<EventType, { win32: string; darwin: string }>> = {
  stop:       { win32: "Speech On.wav",             darwin: "Glass.aiff" },
  permission: { win32: "Windows Message Nudge.wav", darwin: "Funk.aiff" },
};

export function defaultSoundPath(event: EventType, platform: NodeJS.Platform = process.platform): string | undefined {
  const entry = FILENAMES[event];
  if (!entry) return undefined;
  if (platform === "darwin") {
    return path.posix.join("/System/Library/Sounds", entry.darwin);
  }
  const root = process.env.SystemRoot ?? "C:\\Windows";
  return path.win32.join(root, "Media", entry.win32);
}
