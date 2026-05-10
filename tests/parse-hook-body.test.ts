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
});
