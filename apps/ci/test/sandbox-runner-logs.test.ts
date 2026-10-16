import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the pnpm patch of @cloudflare/ci (patches/@cloudflare__ci@0.2.0.patch): readLog returns a bounded string.
const mocks = vi.hoisted(() => ({ getSandbox: vi.fn() }));
vi.mock("@cloudflare/sandbox", () => ({ getSandbox: mocks.getSandbox }));
const { SandboxRunner } = await import("../node_modules/@cloudflare/ci/src/ci/runners/sandbox");

const INLINE_LOG_BYTES = 300_000;
let dir: string;

// Commands that touch the step logs run for real in a temp dir; everything else (checkout, FUSE probe) succeeds.
function fakeSandbox() {
  const exec = vi.fn(async (command: string) => {
    if (!command.includes("/tmp/ci-step.")) return { exitCode: 0, stdout: "", stderr: "" };
    const local = command.replaceAll("/tmp/ci-step.", `${dir}/ci-step.`);
    return { exitCode: 0, stdout: execFileSync("sh", ["-c", local], { encoding: "utf8", maxBuffer: 4 << 20 }), stderr: "" };
  });
  return {
    exec,
    startProcess: vi.fn(async () => ({ waitForExit: async () => ({ exitCode: 0 }) })),
    createBackup: vi.fn(async () => ({ id: "backup-1", dir: "/workspace" })),
    readFile: vi.fn(),
    readFileStream: vi.fn(),
    destroy: vi.fn(async () => {}),
  };
}

async function run() {
  const sandbox = fakeSandbox();
  mocks.getSandbox.mockReturnValue(sandbox);
  const runner = new SandboxRunner({ SANDBOX: {} } as never);
  const result = await runner.run({ label: "build", command: "true", source: { kind: "archive", url: "https://example.com/a.tgz" } });
  return { sandbox, result };
}

describe("patched @cloudflare/ci SandboxRunner logs", () => {
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ci-logs-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("returns small logs inline and destroys the sandbox", async () => {
    writeFileSync(join(dir, "ci-step.out"), "built\n");
    writeFileSync(join(dir, "ci-step.err"), "");
    const { sandbox, result } = await run();
    expect(result.logs).toEqual({ stdout: "built\n", stderr: "" });
    expect(sandbox.destroy).toHaveBeenCalledOnce();
  });

  it("returns a bounded tail with a truncation marker for oversized logs", async () => {
    const big = "x".repeat(1_000_000) + "END\n";
    writeFileSync(join(dir, "ci-step.out"), big);
    writeFileSync(join(dir, "ci-step.err"), "warn\n");
    const { sandbox, result } = await run();
    const stdout = result.logs.stdout as string;
    expect(typeof stdout).toBe("string");
    expect(stdout.startsWith(`[log truncated: showing last ${INLINE_LOG_BYTES} of ${big.length} bytes]\n`)).toBe(true);
    expect(stdout.endsWith("END\n")).toBe(true);
    expect(stdout.length).toBeLessThan(INLINE_LOG_BYTES + 100);
    expect(result.logs.stderr).toBe("warn\n");
    expect(sandbox.readFileStream).not.toHaveBeenCalled();
    expect(sandbox.destroy).toHaveBeenCalledOnce();
  });

  it("does not follow a symlinked log", async () => {
    writeFileSync(join(dir, "secret"), "do not read\n");
    symlinkSync(join(dir, "secret"), join(dir, "ci-step.out"));
    writeFileSync(join(dir, "ci-step.err"), "");
    const { result } = await run();
    expect(result.logs.stdout).toBe("");
    expect(result.logs.stderr).toBe("");
  });
});
