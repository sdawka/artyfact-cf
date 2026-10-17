/**
 * Markers the patched `@cloudflare/ci` puts in a runner's error message when the command itself failed (see
 * src/ci/command-failure.ts in patches/@cloudflare__ci@0.2.0.patch). The Workflow step boundary keeps messages, not classes.
 */
export const COMMAND_FAILURE_MARKERS = ["[ci:exit-code]", "[ci:command-timeout]"] as const;

export interface RunnerFailure {
  runner: string;
  /** True when the command exited non-zero or timed out: a verdict on the candidate, not an infrastructure error. */
  commandFailed: boolean;
}

const hasMarker = (message: unknown) => typeof message === "string" && COMMAND_FAILURE_MARKERS.some((marker) => message.includes(marker));

/**
 * A runner failure from `@cloudflare/ci` (`CiRunnerFailure`), recognised without importing the Workers-only package.
 * The runner group wraps every rejection, so the cause decides: its full message is checked first, because the
 * wrapper's own message keeps only the last 20,000 characters of it.
 */
export function runnerFailure(e: unknown): RunnerFailure | null {
  const err = e as { name?: string; message?: unknown; cause?: { message?: unknown }; runner?: { name?: string } } | null;
  if (err?.name !== "CiRunnerFailure") return null;
  return { runner: err.runner?.name ?? "unknown", commandFailed: hasMarker(err.cause?.message) || hasMarker(err.message) };
}
