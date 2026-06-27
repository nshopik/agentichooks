export type ParsedBody = {
  sessionId?: string;
  cwd?: string;
  message?: string;
  source?: string;
  agentId?: string;
  taskId?: string;
  isInterrupt?: boolean;
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
            source: typeof json.source === "string" ? json.source : undefined,
            agentId: typeof json.agent_id === "string" ? json.agent_id : undefined,
            taskId: typeof json.task_id === "string" ? json.task_id : undefined,
            // PostToolUseFailure sets this true when a user interrupt (Esc) aborted
            // the tool call. The only signal we get for an interrupt — Stop hooks do
            // not fire on interrupts — so deriveRoute uses it to clear the thinking
            // counter. Strict-true guard: a non-boolean value is treated as absent.
            isInterrupt: json.is_interrupt === true ? true : undefined,
          },
        };
      } catch {
        return { kind: "unparseable" };
      }
    },
  };
}
