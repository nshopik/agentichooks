export type ParsedBody = {
  sessionId?: string;
  cwd?: string;
  message?: string;
};

export type BodyOutcome =
  | { kind: "empty" }
  | { kind: "unparseable" }
  | { kind: "oversize" }
  | { kind: "parsed"; body: ParsedBody };

export function makeBodyBuffer(maxBytes = 64 * 1024) {
  let chunks: Buffer[] = [];
  let total = 0;
  let overflow = false;
  return {
    push(chunk: Buffer): void {
      if (overflow) return;
      total += chunk.length;
      if (total > maxBytes) { overflow = true; chunks = []; return; }
      chunks.push(chunk);
    },
    finish(): BodyOutcome {
      if (overflow) return { kind: "oversize" };
      if (total === 0) return { kind: "empty" };
      try {
        const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof json !== "object" || json === null || Array.isArray(json)) return { kind: "unparseable" };
        return {
          kind: "parsed",
          body: {
            sessionId: typeof json.session_id === "string" ? json.session_id : undefined,
            cwd: typeof json.cwd === "string" ? json.cwd : undefined,
            message: typeof json.message === "string" ? json.message : undefined,
          },
        };
      } catch {
        return { kind: "unparseable" };
      }
    },
  };
}
