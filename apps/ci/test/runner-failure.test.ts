import { describe, expect, it, vi } from "vitest";
import { COMMAND_FAILURE_MARKERS, runnerFailure } from "../src/runner-failure";

// Exercises the pnpm patch of @cloudflare/ci (patches/@cloudflare__ci@0.2.0.patch): command failures carry a marker
// that survives the Workflow step boundary and are NonRetryableError unless the runner opts into retrying them.
vi.mock("cloudflare:workflows", () => ({
  NonRetryableError: class NonRetryableError extends Error {
    constructor(message: string, name = "NonRetryableError") {
      super(message);
      this.name = name;
    }
  },
}));
const mocks = vi.hoisted(() => ({ getSandbox: vi.fn() }));
vi.mock("@cloudflare/sandbox", () => ({ getSandbox: mocks.getSandbox }));
const { withStepNotification } = await import("../node_modules/@cloudflare/ci/src/ci/step-notification");
const { EXIT_CODE_FAILURE, COMMAND_TIMEOUT_FAILURE } = await import("../node_modules/@cloudflare/ci/src/ci/command-failure");
const { CiRunnerFailure } = await import("../node_modules/@cloudflare/ci/src/pipeline/failures");
const { SandboxRunner } = await import("../node_modules/@cloudflare/ci/src/ci/runners/sandbox");

const preview = { stdout: "1 test failed", stderr: "" };

/** The error a runner throws out of its Workflow step. */
async function stepError(execution: { exitCode: number } | Error, retryCommandFailures = false): Promise<Error> {
  const run = withStepNotification(
    { handle: null, label: "candidate verification", command: "npm test", sensitiveValues: [], retryCommandFailures },
    async () => {
      if (execution instanceof Error) throw execution;
      return { ...execution, logs: preview, preview, cacheHit: false };
    },
    async (completed) => completed,
  );
  return run.then(() => { throw new Error("step succeeded"); }, (error: Error) => error);
}

/** What the pipeline sees: the error rehydrated across the step boundary (class lost), wrapped like the runner group. */
function acrossStepBoundary(error: Error, rewrite = (message: string) => message) {
  const rehydrated = structuredClone(error);
  rehydrated.message = rewrite(rehydrated.message);
  return new CiRunnerFailure({ cause: rehydrated, order: 0, runner: { name: "candidate verification", command: "npm test" } });
}

describe("patched @cloudflare/ci command failures", () => {
  it("shares its markers with the classifier", () => {
    expect(COMMAND_FAILURE_MARKERS).toEqual([EXIT_CODE_FAILURE, COMMAND_TIMEOUT_FAILURE]);
  });

  it("throws a non-zero exit as a marked NonRetryableError", async () => {
    const error = await stepError({ exitCode: 1 });
    expect(error.name).toBe("NonRetryableError");
    expect(error.message).toMatch(/^\[ci:exit-code\] candidate verification failed with exit code 1\n/);
    expect(error.message).toContain("1 test failed");
  });

  it("keeps a non-zero exit retryable when the runner opts in", async () => {
    const error = await stepError({ exitCode: 1 }, true);
    expect(error.name).toBe("Error");
    expect(error.message).toContain(EXIT_CODE_FAILURE);
  });

  it("leaves an infrastructure error retryable and unmarked", async () => {
    const error = await stepError(new Error("Connection closed: this Durable Object instance is no longer active"));
    expect(error.name).toBe("Error");
    expect(runnerFailure(acrossStepBoundary(error))).toEqual({ runner: "candidate verification", commandFailed: false });
  });

  it("classifies a non-zero exit as a command failure after a serialise round trip", async () => {
    const error = await stepError({ exitCode: 1 });
    expect(structuredClone(error)).not.toBeInstanceOf(CiRunnerFailure);
    expect(runnerFailure(acrossStepBoundary(error))).toEqual({ runner: "candidate verification", commandFailed: true });
    // Workflows may prefix or quote the message of a NonRetryableError it rethrows.
    expect(runnerFailure(acrossStepBoundary(error, (m) => `NonRetryableError: ${m}`))?.commandFailed).toBe(true);
    expect(runnerFailure(acrossStepBoundary(error, (m) => `Step threw a NonRetryableError with message "${m}"`))?.commandFailed).toBe(true);
  });

  it("finds the marker in the cause when the wrapper truncates a long output", async () => {
    const error = await stepError({ exitCode: 1 });
    error.message += "x".repeat(30_000);
    const failure = acrossStepBoundary(error);
    expect(failure.message).not.toContain(EXIT_CODE_FAILURE);
    expect(runnerFailure(failure)?.commandFailed).toBe(true);
  });

  it("ignores errors that are not runner failures", () => {
    expect(runnerFailure(new Error(`${EXIT_CODE_FAILURE} not wrapped`))).toBeNull();
    expect(runnerFailure(null)).toBeNull();
  });
});

describe("patched @cloudflare/ci SandboxRunner command timeout", () => {
  function sandboxTimingOut(error: Error) {
    const sandbox = {
      exec: vi.fn(async (command: string) => ({ exitCode: 0, stdout: command.startsWith("tail") ? "still running" : "", stderr: "" })),
      startProcess: vi.fn(async () => ({ waitForExit: async () => { throw error; } })),
      destroy: vi.fn(async () => {}),
    };
    mocks.getSandbox.mockReturnValue(sandbox);
    return new SandboxRunner({ SANDBOX: {} } as never).run({
      label: "candidate verification", command: "npm test", timeoutMs: 5, source: { kind: "archive", url: "https://example.com/a.tgz" },
    });
  }

  it("marks the SDK's process-exit timeout, even with its class name lost over RPC", async () => {
    const timeout = new Error("Process did not become ready within 5ms. Waiting for: process exit");
    const error = await sandboxTimingOut(timeout).then(() => { throw new Error("run succeeded"); }, (e: Error) => e);
    expect(error.message).toMatch(/^\[ci:command-timeout\] candidate verification timed out after 5ms\n/);
    expect(error.message).toContain("still running");
    expect(runnerFailure(acrossStepBoundary(error))?.commandFailed).toBe(true);
  });

  it("rethrows any other wait failure unmarked", async () => {
    const lost = new Error("Connection closed: this Durable Object instance is no longer active");
    await expect(sandboxTimingOut(lost)).rejects.toBe(lost);
  });

  it("makes a timed-out command final through withStepNotification", async () => {
    const error = await stepError(new Error(`${COMMAND_TIMEOUT_FAILURE} candidate verification timed out after 5ms`));
    expect(error.name).toBe("NonRetryableError");
  });
});
