import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EventType } from "./types.js";

const cache = new Map<string, string>();

function pluginRoot(): string {
  // The bundled plugin.js lives at <plugin>/bin/plugin.js.
  // import.meta.url at runtime points to that built file.
  const here = fileURLToPath(import.meta.url);
  return path.dirname(path.dirname(here));
}

export function keyIconBase64(event: EventType, kind: "idle" | "alert"): string {
  const key = `${event}-${kind}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const filePath = path.join(pluginRoot(), "images", "keys", `${key}.png`);
  const buf = fs.readFileSync(filePath);
  const dataUri = `data:image/png;base64,${buf.toString("base64")}`;
  cache.set(key, dataUri);
  return dataUri;
}

export function readImageAsDataUri(absPath: string): string {
  const cached = cache.get(absPath);
  if (cached) return cached;
  const ext = path.extname(absPath).toLowerCase();
  const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".svg" ? "image/svg+xml" : "image/png";
  const buf = fs.readFileSync(absPath);
  const dataUri = `data:${mime};base64,${buf.toString("base64")}`;
  cache.set(absPath, dataUri);
  return dataUri;
}
