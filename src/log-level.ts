export type LogLevel = "info" | "debug" | "trace";

// Mirror of the three flag names checked by the Elgato SDK's isDebugMode()
// (node_modules/@elgato/streamdeck/dist/plugin/common/utils.js:8-15).
// We mirror rather than import because that path is not a public SDK export.
const INSPECT_FLAGS = new Set(["--inspect", "--inspect-brk", "--inspect-port"]);

function isDebugMode(execArgv: readonly string[]): boolean {
  return execArgv.some((arg) => INSPECT_FLAGS.has(arg.split("=")[0]));
}

/**
 * Returns the log level to pass to `streamDeck.logger.setLevel`, or `null`
 * when the SDK's own debug seed should be left undisturbed (i.e. dev mode
 * with no trace upgrade requested).
 *
 * Behavior matrix:
 *   production + no env         → "info"
 *   production + DEBUG=1        → "debug"
 *   production + DEBUG=trace    → "trace"
 *   dev (--inspect*) + no env   → null   (SDK seeds debug)
 *   dev + DEBUG=1               → null   (SDK already debug, env is no-op)
 *   dev + DEBUG=trace           → "trace" (explicit upgrade from debug)
 */
export function pickLogLevel(
  execArgv: readonly string[],
  env: Partial<Record<string, string>>,
): LogLevel | null {
  const debugEnv = env.AGENTIC_HOOKS_DEBUG;
  if (isDebugMode(execArgv)) {
    return debugEnv === "trace" ? "trace" : null;
  }
  if (debugEnv === "trace") return "trace";
  if (debugEnv) return "debug";
  return "info";
}
