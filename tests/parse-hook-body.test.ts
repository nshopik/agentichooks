import { describe, it, expect } from "vitest";
import { makeBodyBuffer } from "../src/parse-hook-body.js";

describe("makeBodyBuffer", () => {
  it("returns {kind:'empty'} when no chunks pushed", () => {
    const buf = makeBodyBuffer();
    expect(buf.finish()).toEqual({ kind: "empty" });
  });

  it("returns {kind:'unparseable'} for invalid JSON bytes", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from("not json"));
    expect(buf.finish()).toEqual({ kind: "unparseable" });
  });

  it("returns {kind:'unparseable'} for a JSON string (non-object)", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify("a string")));
    expect(buf.finish()).toEqual({ kind: "unparseable" });
  });

  it("returns {kind:'unparseable'} for a JSON array (non-object)", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify([1, 2])));
    expect(buf.finish()).toEqual({ kind: "unparseable" });
  });

  it("returns {kind:'oversize'} when chunks exceed maxBytes", () => {
    const buf = makeBodyBuffer(10);
    buf.push(Buffer.alloc(6));
    buf.push(Buffer.alloc(6)); // total 12 > 10
    expect(buf.finish()).toEqual({ kind: "oversize" });
  });

  it("extracts sessionId, cwd, message from a valid body", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ session_id: "abc123def456", cwd: "/home/user/project", message: "hello" })));
    expect(buf.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: "abc123def456", cwd: "/home/user/project", message: "hello" },
    });
  });

  it("returns undefined for fields that are missing", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ session_id: "abc" })));
    expect(buf.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: "abc", cwd: undefined, message: undefined },
    });
  });

  it("returns undefined for fields that are non-string (number session_id, object cwd, boolean message)", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ session_id: 42, cwd: { path: "x" }, message: true })));
    expect(buf.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: undefined, cwd: undefined, message: undefined },
    });
  });

  it("correctly concatenates multiple chunks", () => {
    const full = JSON.stringify({ session_id: "sid", cwd: "/a/b", message: "m" });
    const mid = Math.floor(full.length / 2);
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(full.slice(0, mid)));
    buf.push(Buffer.from(full.slice(mid)));
    expect(buf.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: "sid", cwd: "/a/b", message: "m" },
    });
  });

  it("extracts source when present as a string", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ session_id: "abc", source: "compact" })));
    expect(buf.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: "abc", cwd: undefined, message: undefined, source: "compact" },
    });
  });

  it("returns undefined for source that is a non-string (number, object, null)", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ source: 42 })));
    expect(buf.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: undefined, cwd: undefined, message: undefined, source: undefined },
    });

    const buf2 = makeBodyBuffer();
    buf2.push(Buffer.from(JSON.stringify({ source: { nested: true } })));
    expect(buf2.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: undefined, cwd: undefined, message: undefined, source: undefined },
    });

    const buf3 = makeBodyBuffer();
    buf3.push(Buffer.from(JSON.stringify({ source: null })));
    expect(buf3.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: undefined, cwd: undefined, message: undefined, source: undefined },
    });
  });

  it("extracts agentId when agent_id is a string", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ session_id: "abc", agent_id: "agt-001-xyz" })));
    expect(buf.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: "abc", cwd: undefined, message: undefined, source: undefined, agentId: "agt-001-xyz" },
    });
  });

  it("returns undefined for agentId when agent_id is a number, object, or null", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ agent_id: 42 })));
    expect(buf.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: undefined, cwd: undefined, message: undefined, source: undefined, agentId: undefined },
    });

    const buf2 = makeBodyBuffer();
    buf2.push(Buffer.from(JSON.stringify({ agent_id: { id: "x" } })));
    expect(buf2.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: undefined, cwd: undefined, message: undefined, source: undefined, agentId: undefined },
    });

    const buf3 = makeBodyBuffer();
    buf3.push(Buffer.from(JSON.stringify({ agent_id: null })));
    expect(buf3.finish()).toEqual({
      kind: "parsed",
      body: { sessionId: undefined, cwd: undefined, message: undefined, source: undefined, agentId: undefined },
    });
  });

  it("extracts taskId when task_id is a string", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ session_id: "abc", task_id: "task-xyz-001" })));
    expect(buf.finish()).toEqual({
      kind: "parsed",
      body: {
        sessionId: "abc",
        cwd: undefined,
        message: undefined,
        source: undefined,
        agentId: undefined,
        taskId: "task-xyz-001",
      },
    });
  });

  it("returns undefined for taskId when task_id is a number or missing", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ task_id: 42 })));
    expect(buf.finish()).toEqual({
      kind: "parsed",
      body: {
        sessionId: undefined,
        cwd: undefined,
        message: undefined,
        source: undefined,
        agentId: undefined,
        taskId: undefined,
      },
    });

    const buf2 = makeBodyBuffer();
    buf2.push(Buffer.from(JSON.stringify({ session_id: "abc" })));
    expect(buf2.finish()).toEqual({
      kind: "parsed",
      body: {
        sessionId: "abc",
        cwd: undefined,
        message: undefined,
        source: undefined,
        agentId: undefined,
        taskId: undefined,
      },
    });
  });

  it("extracts isInterrupt as true only when is_interrupt is the boolean true", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ session_id: "abc", is_interrupt: true })));
    const outcome = buf.finish();
    expect(outcome).toMatchObject({ kind: "parsed", body: { isInterrupt: true } });
  });

  it("returns undefined for isInterrupt when is_interrupt is false, missing, or non-boolean", () => {
    for (const value of [false, "true", 1, undefined]) {
      const buf = makeBodyBuffer();
      buf.push(Buffer.from(JSON.stringify({ session_id: "abc", is_interrupt: value })));
      const outcome = buf.finish();
      if (outcome.kind !== "parsed") throw new Error("expected parsed");
      expect(outcome.body.isInterrupt).toBeUndefined();
    }
  });
});

describe("makeBodyBuffer — agenticTaskCount (background_tasks)", () => {
  it("returns undefined when background_tasks is absent", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ session_id: "abc" })));
    const outcome = buf.finish();
    if (outcome.kind !== "parsed") throw new Error("expected parsed");
    expect(outcome.body.agenticTaskCount).toBeUndefined();
  });

  it("returns undefined when background_tasks is not an array", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ session_id: "abc", background_tasks: "not-an-array" })));
    const outcome = buf.finish();
    if (outcome.kind !== "parsed") throw new Error("expected parsed");
    expect(outcome.body.agenticTaskCount).toBeUndefined();
  });

  it("counts entries whose type is in the agentic set", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({
      session_id: "abc",
      background_tasks: [
        { type: "subagent" },
        { type: "workflow" },
        { type: "teammate" },
        { type: "cloud session" },
        { type: "MCP task" },
      ],
    })));
    const outcome = buf.finish();
    if (outcome.kind !== "parsed") throw new Error("expected parsed");
    expect(outcome.body.agenticTaskCount).toBe(5);
  });

  it("does not count shell/monitor entries or unrecognized type values", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({
      session_id: "abc",
      background_tasks: [
        { type: "shell" },
        { type: "monitor" },
        { type: "future-type-nobody-has-heard-of" },
      ],
    })));
    const outcome = buf.finish();
    if (outcome.kind !== "parsed") throw new Error("expected parsed");
    expect(outcome.body.agenticTaskCount).toBe(0);
  });

  it("counts a mix of agentic and non-agentic entries", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({
      session_id: "abc",
      background_tasks: [
        { type: "subagent" },
        { type: "shell" },
        { type: "workflow" },
        { type: "monitor" },
      ],
    })));
    const outcome = buf.finish();
    if (outcome.kind !== "parsed") throw new Error("expected parsed");
    expect(outcome.body.agenticTaskCount).toBe(2);
  });

  it("counts all entries regardless of a status field", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({
      session_id: "abc",
      background_tasks: [
        { type: "subagent", status: "completed" },
        { type: "subagent", status: "running" },
      ],
    })));
    const outcome = buf.finish();
    if (outcome.kind !== "parsed") throw new Error("expected parsed");
    expect(outcome.body.agenticTaskCount).toBe(2);
  });

  it("treats an empty array as zero agentic tasks", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({ session_id: "abc", background_tasks: [] })));
    const outcome = buf.finish();
    if (outcome.kind !== "parsed") throw new Error("expected parsed");
    expect(outcome.body.agenticTaskCount).toBe(0);
  });

  it("treats non-object entries (string, number, null) as contributing 0", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({
      session_id: "abc",
      background_tasks: ["not-an-object", 42, null, { type: "subagent" }],
    })));
    const outcome = buf.finish();
    if (outcome.kind !== "parsed") throw new Error("expected parsed");
    expect(outcome.body.agenticTaskCount).toBe(1);
  });

  it("treats entries with a non-string or missing type as contributing 0", () => {
    const buf = makeBodyBuffer();
    buf.push(Buffer.from(JSON.stringify({
      session_id: "abc",
      background_tasks: [{ type: 42 }, { type: null }, { notype: "subagent" }],
    })));
    const outcome = buf.finish();
    if (outcome.kind !== "parsed") throw new Error("expected parsed");
    expect(outcome.body.agenticTaskCount).toBe(0);
  });
});
