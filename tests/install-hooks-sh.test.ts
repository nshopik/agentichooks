/**
 * install-hooks-sh.test.ts
 *
 * Spawns the real install-hooks.sh against a temp settings.json so tests
 * never touch ~/.claude/settings.json.
 *
 * Platform gate: skips on Windows (process.platform === "win32") and when
 * bash or jq is not available on PATH.  install-hooks.sh is a non-Windows
 * artifact; Git Bash + MSYS path translation (mktemp, mv, cross-volume) is
 * an unvalidated failure risk that is out of scope.  Runs on macos-latest CI
 * and Linux dev boxes where bash and jq are available.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Platform detection: require bash and jq.
// ---------------------------------------------------------------------------
function hasBash(): boolean {
  const r = spawnSync("bash", ["--version"], { encoding: "utf8", timeout: 5000 });
  return r.status === 0 && r.error == null;
}

function hasJq(): boolean {
  const r = spawnSync("jq", ["--version"], { encoding: "utf8", timeout: 5000 });
  return r.status === 0 && r.error == null;
}

// Also skip on Windows: install-hooks.sh is a non-Windows artifact and
// Git Bash path translation (mktemp → MSYS /tmp, cross-volume mv) is an
// unvalidated failure risk out of scope for this plan.
const SUITE_AVAILABLE =
  process.platform !== "win32" && hasBash() && hasJq();

// On non-Windows, bash and jq must be available — a silent skip would hide
// every sh test from the platforms that actually run the installer.
it.runIf(process.platform !== "win32")(
  "bash and jq are available (non-Windows must not silently skip)",
  () => {
    expect(SUITE_AVAILABLE).toBe(true);
  }
);

// Absolute path to the script under test.
const SCRIPT_PATH = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "..",
  "install-hooks.sh"
);

// ---------------------------------------------------------------------------
// Helper: run install-hooks.sh with SETTINGS_PATH pointing at a temp file.
// ---------------------------------------------------------------------------
function runInstaller(settingsPath: string): {
  status: number;
  stdout: string;
  stderr: string;
  error?: Error;
} {
  const result = spawnSync("bash", [SCRIPT_PATH], {
    encoding: "utf8",
    timeout: 30000,
    env: {
      ...process.env,
      SETTINGS_PATH: settingsPath,
    },
  });
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

describe.skipIf(!SUITE_AVAILABLE)(
  "install-hooks.sh",
  () => {
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-sh-test-"));
      settingsPath = path.join(tmpDir, "settings.json");
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // ------------------------------------------------------------------
    // Test 1: Smoke — installer exits 0 and writes parseable JSON.
    // ------------------------------------------------------------------
    it("exits 0 and writes valid JSON to the SETTINGS_PATH", () => {
      const result = runInstaller(settingsPath);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error?.message ?? "none"}`).toBe(0);
      expect(fs.existsSync(settingsPath)).toBe(true);
      const raw = fs.readFileSync(settingsPath, "utf8");
      expect(() => JSON.parse(raw)).not.toThrow();
    }, 45000);

    // ------------------------------------------------------------------
    // Test 2: Atomicity — the script uses temp-file-then-rename so no
    // partial write is committed to the target path.  We verify the
    // side-effect: no leftover temp files in tmpDir after a successful run.
    // (mktemp creates its temp in /tmp, not in tmpDir, so tmpDir should
    // contain only settings.json after the run.)
    // ------------------------------------------------------------------
    it("leaves no temp files in the settings directory after a successful run", () => {
      const result = runInstaller(settingsPath);
      expect(result.status, `stdout: ${result.stdout}\nstderr: ${result.stderr}\nerror: ${result.error?.message ?? "none"}`).toBe(0);

      const leftovers = fs.readdirSync(tmpDir).filter((e) => e !== "settings.json");
      expect(leftovers, `unexpected leftovers: ${leftovers.join(", ")}`).toEqual([]);
    }, 45000);

    // ------------------------------------------------------------------
    // Test 3: Deep-nesting round-trip — jq has no -Depth equivalent;
    // values at any nesting depth are serialized correctly by default.
    // This test documents and guards that guarantee.
    // ------------------------------------------------------------------
    it("preserves settings values nested more than 10 levels deep", () => {
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

      const reached =
        parsed?.myApp?.l1?.l2?.l3?.l4?.l5?.l6?.l7?.l8?.l9?.l10?.l11;
      expect(reached, `parsed at depth ~2: ${JSON.stringify(parsed?.myApp?.l1?.l2)}`).toBe(sentinel);
    }, 45000);

    // ------------------------------------------------------------------
    // Test 4: Idempotency — second run exits 0 and produces identical JSON.
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
  }
);
