import path from "node:path";
import type { EventType } from "./types.js";

const FILENAMES: Record<EventType, string> = {
  stop: "Speech On.wav",
  idle: "Windows Notify System Generic.wav",
  permission: "Windows Message Nudge.wav",
};

export function defaultSoundPath(event: EventType): string {
  const root = process.env.SystemRoot ?? "C:\\Windows";
  return path.win32.join(root, "Media", FILENAMES[event]);
}
