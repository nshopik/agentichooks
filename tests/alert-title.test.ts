import { describe, it, expect } from "vitest";
import { formatAlertTitle } from "../src/alert-title.js";

describe("formatAlertTitle", () => {
  // Basic basename extraction (forward slash)
  it("returns basename from a Unix-style path with count=1", () => {
    expect(formatAlertTitle(1, "/home/user/my-project")).toBe("my-project");
  });

  // Basic basename extraction (backslash)
  it("returns basename from a Windows-style path with count=1", () => {
    expect(formatAlertTitle(1, "C:\\Users\\user\\my-project")).toBe("my-project");
  });

  // Mixed separators
  it("handles mixed separators — splits on both / and backslash", () => {
    expect(formatAlertTitle(1, "/home/user\\mixed-repo")).toBe("mixed-repo");
  });

  // +N marker: count=2, one session shown + +1
  it("appends newline+N for count=2 (N = count - 1 = 1)", () => {
    expect(formatAlertTitle(2, "/x/repo")).toBe("repo\n+1");
  });

  // +N marker: count=3
  it("appends +2 for count=3", () => {
    expect(formatAlertTitle(3, "/repos/alpha")).toBe("alpha\n+2");
  });

  // null cwd → basename omitted; count=1 → empty string
  it("returns empty string when cwd is null and count=1", () => {
    expect(formatAlertTitle(1, null)).toBe("");
  });

  // null cwd + count > 1 → only "+N"
  it("returns '+N' when cwd is null and count > 1", () => {
    expect(formatAlertTitle(3, null)).toBe("+2");
  });

  // empty-string cwd ≡ null (spec requirement)
  it("treats empty-string cwd like null (returns '' for count=1)", () => {
    expect(formatAlertTitle(1, "")).toBe("");
  });

  // empty-string cwd + count > 1
  it("treats empty-string cwd like null (returns '+N' for count > 1)", () => {
    expect(formatAlertTitle(2, "")).toBe("+1");
  });

  // root-only Unix path: basename resolves empty → omit
  it("omits basename for root-only Unix path '/'", () => {
    expect(formatAlertTitle(1, "/")).toBe("");
  });

  it("omits basename for root-only Unix path with count=2", () => {
    expect(formatAlertTitle(2, "/")).toBe("+1");
  });

  // root-only Windows path: "C:\\" has no meaningful basename
  it("omits basename for root-only Windows path 'C:\\'", () => {
    expect(formatAlertTitle(1, "C:\\")).toBe("");
  });

  // count=0 and count=1 with no cwd → empty
  it("returns empty string for count=0 and no cwd", () => {
    expect(formatAlertTitle(0, null)).toBe("");
  });

  // Two windows same basename: title shows name + +1
  it("two sessions same repo basename → count=2, title shows name + +1", () => {
    expect(formatAlertTitle(2, "/projects/claudenotify")).toBe("claudenotify\n+1");
  });

  // Windows path with a drive letter followed by a real directory
  it("returns dir name for Windows path 'C:\\Users' (not the drive designator)", () => {
    expect(formatAlertTitle(1, "C:\\Users")).toBe("Users");
  });

  // Trailing separators are dropped (filter absorbs the trailing empty segment)
  it("ignores trailing separators in both styles", () => {
    expect(formatAlertTitle(1, "/x/repo/")).toBe("repo");
    expect(formatAlertTitle(1, "C:\\Users\\repo\\")).toBe("repo");
  });

  // UNC path: leading \\ produces empty segments the filter must absorb
  it("returns basename from a UNC path", () => {
    expect(formatAlertTitle(1, "\\\\server\\share\\repo")).toBe("repo");
  });
});
