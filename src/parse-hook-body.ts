export type ParsedBody = {
  sessionId?: string;
  cwd?: string;
  message?: string;
  source?: string;
  agentId?: string;
  taskId?: string;
  isInterrupt?: boolean;
  agenticTaskCount?: number;
};

// Wire values for background_tasks[].type that represent agentic work still in
// flight — a Stop reporting any of these is a stop-clearing signal, not a
// chime. "cloud session" and "MCP task" carry literal spaces; copy verbatim
// from hooks-reference.md, don't retype. shell/monitor and any unrecognized
// type are NOT suppressed — fail toward chiming (a stranded dev server or
// tail -f must not mute completion forever).
const AGENTIC_TASK_TYPES = new Set(["subagent", "workflow", "teammate", "cloud session", "MCP task"]);

// Counts background_tasks entries whose type is in AGENTIC_TASK_TYPES. Absent
// or non-array input returns undefined (mirrors the isInterrupt absent
// convention) so the dispatcher gate can distinguish "no signal" from "zero
// tasks reported". Non-object entries and non-string types contribute 0 —
// malformed entries fail toward chiming, not toward suppressing.
function countAgenticTasks(raw: unknown): number | undefined {
  if (!Array.isArray(raw)) return undefined;
  let count = 0;
  for (const entry of raw) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { type?: unknown }).type === "string" &&
      AGENTIC_TASK_TYPES.has((entry as { type: string }).type)
    ) {
      count++;
    }
  }
  return count;
}

export type BodyOutcome =
  | { kind: "empty" }
  | { kind: "unparseable" }
  | { kind: "oversize" }
  | { kind: "parsed"; body: ParsedBody };

export function makeBodyBuffer(maxBytes = 256 * 1024) {
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
            agenticTaskCount: countAgenticTasks(json.background_tasks),
          },
        };
      } catch {
        return { kind: "unparseable" };
      }
    },
  };
}
