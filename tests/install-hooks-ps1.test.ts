/**
 * install-hooks-ps1.test.ts
 *
 * Spawns the real install-hooks.ps1 against a temp settings.json so tests
 * never touch ~/.claude/settings.json.
 *
 * Platform gate: skips the entire suite when powershell.exe is not on PATH
 * (macOS CI). The suite runs on windows-latest CI and any Windows dev box.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Platform detection: probe for powershell.exe on PATH.
// On macOS/Linux this returns a non-zero status; skip the whole suite.
// ---------------------------------------------------------------------------
function hasPowershell(): boolean {
  const result = spawnSync("powershell.exe", ["-Command", "exit 0"], {
    encoding: "utf8",
    // 15 s: PowerShell cold-start on a loaded CI runner can exceed 5 s.
    timeout: 15000,
  });
  return result.status === 0 && result.error == null;
}

const POWERSHELL_AVAILABLE = hasPowershell();

// On Windows, powershell.exe must be available — a silent skip would hide
// every ps1 test from the platform that actually runs the installer.
it.runIf(process.platform === "win32")(
  "powershell.exe is available (Windows must not silently skip)",
  () => {
    expect(POWERSHELL_AVAILABLE).toBe(true);
  }
);

// Absolute path to the script under test (resolved from repo root).
const SCRIPT_PATH = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "..",
  "install-hooks.ps1"
);

// ---------------------------------------------------------------------------
// Helper: run install-hooks.ps1 against a given settings file path.
// Returns { status, stdout, stderr, error }.
// ---------------------------------------------------------------------------
function runInstaller(settingsPath: string): {
  status: number;
  stdout: string;
  stderr: string;
  error?: Error;
} {
  const result = spawnSync(
    "powershell.exe",
    [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      SCRIPT_PATH,
      "-SettingsPath",
      settingsPath,
    ],
    {
      encoding: "utf8",
      timeout: 30000,
    }
  );
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

// ---------------------------------------------------------------------------
// Shared temp dir per test.
// ---------------------------------------------------------------------------
let tmpDir: string;
let settingsPath: string;

describe.skipIf(!POWERSHELL_AVAILABLE)(
  "install-hooks.ps1",
  () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-ps1-test-"));
      settingsPath = path.join(tmpDir, "settings.json");
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ------------------------------------------------------------------
    // Test 1: Smoke — installer exits 0 and writes a parseable JSON file.
    // ------------------------------------------------------------------
    it("exits 0 and writes valid JSON to the target path", () => {
      const result = runInstaller(settingsPath);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error?.message ?? "none"}`).toBe(0);
      expect(fs.existsSync(settingsPath)).toBe(true);
      const raw = fs.readFileSync(settingsPath, "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();

      const parsed = JSON.parse(raw);

      // (a) Stop hook entry: parsed.hooks.Stop -> [ { hooks: [ {type,url,timeout,marker} ] } ]
      const stopHook = parsed?.hooks?.Stop?.[0]?.hooks?.[0];
      expect(stopHook?.type).toBe("http");
      expect(stopHook?.url).toMatch(/\/event\/stop$/);
      expect(stopHook?.timeout).toBe(2);
      expect(stopHook?.["_agentic-hooks-installer"]).toBe("v2");

      // (b) all 29 managed event keys installed (11 action + 18 info)
      const eventKeys = Object.keys(parsed?.hooks ?? {});
      expect(eventKeys.length).toBe(29);
      expect(eventKeys).toContain("Stop");
      expect(eventKeys).toContain("SubagentStart");
    }, 45000);

    // ------------------------------------------------------------------
    // Test 2: Depth round-trip — a value nested 11 levels deep must
    // survive unchanged.  With -Depth 10, ConvertTo-Json stringifies the
    // level-10 object via its .ToString() representation, producing a
    // string like "@{l11=depth-sentinel-value}"; navigating to .l11 then
    // yields undefined.  This test is RED until -Depth is raised.
    // ------------------------------------------------------------------
    it("preserves settings values nested more than 10 levels deep", () => {
      // Build a fixture: { "myApp": { "l1": { "l2": … { "l11": "sentinel" } … } } }
      // That is 11 levels of nesting inside the top-level object.
      const sentinel = "depth-sentinel-value";
      const deep = {
        myApp: {
          l1: {
            l2: {
              l3: {
                l4: {
                  l5: {
                    l6: {
                      l7: {
                        l8: {
                          l9: {
                            l10: {
                              l11: sentinel,
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };
      fs.writeFileSync(settingsPath, JSON.stringify(deep), "utf8");

      const result = runInstaller(settingsPath);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error?.message ?? "none"}`).toBe(0);

      const raw = fs.readFileSync(settingsPath, "utf8");
      const parsed = JSON.parse(raw);

      // Navigate all 11 levels and assert the sentinel is intact.
      const reached =
        parsed?.myApp?.l1?.l2?.l3?.l4?.l5?.l6?.l7?.l8?.l9?.l10?.l11;
      expect(reached, `parsed at depth ~2: ${JSON.stringify(parsed?.myApp?.l1?.l2)}`).toBe(sentinel);
    }, 45000);

    // ------------------------------------------------------------------
    // Test 3: Atomicity — no partial write is visible at the target path.
    // We cannot intercept mid-write reliably, so we verify the side-effect:
    // after a run there are no leftover temp files in the same directory.
    // With the current Set-Content approach there are none (the failure mode
    // is a truncated target, not a temp file), so this test also acts as a
    // canary that the new temp-file approach cleans up after itself.
    // ------------------------------------------------------------------
    it("leaves no temp files in the settings directory after a successful run", () => {
      const result = runInstaller(settingsPath);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error?.message ?? "none"}`).toBe(0);

      // Only settings.json should be present; any .tmp or partial files are a bug.
      const leftovers = fs.readdirSync(tmpDir).filter((e) => e !== "settings.json");
      expect(leftovers, `unexpected leftovers: ${leftovers.join(", ")}`).toEqual([]);
    }, 45000);

    // ------------------------------------------------------------------
    // Test 4: Idempotency — running twice produces the same output and
    // exits 0 both times (regression guard for the rewrite).
    // ------------------------------------------------------------------
    it("is idempotent: second run exits 0 and produces identical JSON", () => {
      const r1 = runInstaller(settingsPath);
      expect(r1.status, `stdout: ${r1.stdout}\nstderr: ${r1.stderr}\nerror: ${r1.error?.message ?? "none"}`).toBe(0);
      const afterFirst = fs.readFileSync(settingsPath, "utf8");

      const r2 = runInstaller(settingsPath);
      expect(r2.status, `stdout: ${r2.stdout}\nstderr: ${r2.stderr}\nerror: ${r2.error?.message ?? "none"}`).toBe(0);
      const afterSecond = fs.readFileSync(settingsPath, "utf8");

      expect(JSON.parse(afterFirst)).toEqual(JSON.parse(afterSecond));
    }, 75000);

    // ------------------------------------------------------------------
    // Test 5: BOM-absence — the written settings.json must NOT start with
    // a UTF-8 BOM (0xEF 0xBB 0xBF). Node's readFileSync("utf8") silently
    // strips BOMs, so this test reads the raw Buffer instead.
    // As a sanity anchor: the first byte must be '{' (0x7B), confirming
    // the file starts with valid JSON rather than whitespace or a BOM.
    // ------------------------------------------------------------------
    it("writes settings.json without a UTF-8 BOM", () => {
      const result = runInstaller(settingsPath);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error?.message ?? "none"}`).toBe(0);

      const buf = fs.readFileSync(settingsPath);
      // Sanity anchor: file must start with '{' (0x7B).
      expect(buf[0], "first byte should be '{' (0x7B) — file must start with valid JSON").toBe(0x7b);
      // BOM guard: first three bytes must NOT be EF BB BF.
      const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
      expect(hasBom, "settings.json must not begin with a UTF-8 BOM (EF BB BF)").toBe(false);
    }, 45000);

    // ------------------------------------------------------------------
    // Test 6: Bare-filename -SettingsPath — passing a plain filename (no
    // directory component) must succeed. The installer must resolve it
    // against the process CWD, create the file there, and exit 0.
    // Previously, Split-Path "settings.json" -Parent returned "" which
    // caused Test-Path "" to throw a confusing error.
    // ------------------------------------------------------------------
    it("accepts a bare filename -SettingsPath and writes the file in the CWD", () => {
      // Use a fresh temp dir as the CWD for the child process.
      const bareTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-bare-"));
      try {
        const result = spawnSync(
          "powershell.exe",
          [
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            SCRIPT_PATH,
            "-SettingsPath",
            "settings.json",
          ],
          {
            encoding: "utf8",
            timeout: 45000,
            cwd: bareTmpDir,
          }
        );
        const status = result.status ?? 1;
        const stdout = result.stdout ?? "";
        const stderr = result.stderr ?? "";
        const errorMsg = result.error?.message ?? "none";
        expect(status, `stdout: ${stdout}\nstderr: ${stderr}\nerror: ${errorMsg}`).toBe(0);

        const bareSettingsPath = path.join(bareTmpDir, "settings.json");
        expect(fs.existsSync(bareSettingsPath), "settings.json should exist in the CWD").toBe(true);
        const raw = fs.readFileSync(bareSettingsPath, "utf8");
        const parsed = JSON.parse(raw);
        // Verify at least one of our managed hook entries is present.
        expect(parsed?.hooks?.Stop).toBeDefined();
      } finally {
        fs.rmSync(bareTmpDir, { recursive: true, force: true });
      }
    }, 45000);
  }
);
