import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { taskLines, waveScript } from "./lib";

/**
 * Runs the copied wave script in a real POSIX shell with stand-in `npx` and `claude` executables that log their working
 * directory, then prints the shell's own directory at the end. The script's own exit status is ignored (a failed claim).
 */
function runScript(script: string, failing?: string) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "p7b-script-")));
  const bin = join(root, "bin");
  const log = join(root, "log");
  execFileSync("mkdir", ["-p", bin, join(root, "shell")]);
  // npx artyfact task <verb> <plan> <task> --system <sid> --dir <dir>: log where it ran and create the workspace.
  // A claim into `failing` exits 1 before it creates the workspace.
  writeFileSync(join(bin, "npx"), `#!/bin/sh\necho "claim $(pwd) $9 admin=\${ARTYFACT_ADMIN_TOKEN:-unset}" >> "${log}"\n[ "$9" = "${failing ?? ""}" ] && exit 1\nmkdir -p "$9"\n`);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "agent $(pwd) admin=\${ARTYFACT_ADMIN_TOKEN:-unset} plain=\${ADMIN_TOKEN:-unset}" >> "${log}"\n`);
  chmodSync(join(bin, "npx"), 0o755);
  chmodSync(join(bin, "claude"), 0o755);
  const cwd = join(root, "shell");
  // ADMIN_TOKEN is a plain shell variable, set without exporting it, as the hint says; nothing is in the environment.
  const out = execFileSync("/bin/sh", ["-c", `ADMIN_TOKEN=admin\n${script}\npwd`], { cwd, env: { PATH: `${bin}:/usr/bin:/bin` } }).toString().trim();
  return { cwd, finalDir: out.split("\n").at(-1), log: readFileSync(log, "utf8").trim().split("\n").sort() };
}

describe("copied wave script", () => {
  const plan = { id: "plan.one", systemId: "system.peopling" };

  it("never changes the parent shell's directory, claims from it, and runs each agent in its own workspace without the admin token", () => {
    const script = waveScript([taskLines("claim", plan, "t1"), taskLines("claim", plan, "t2")]);
    const { cwd, finalDir, log } = runScript(script);
    expect(finalDir).toBe(cwd);
    expect(log).toEqual([
      `agent ${cwd}/work/t1 admin=unset plain=unset`,
      `agent ${cwd}/work/t2 admin=unset plain=unset`,
      `claim ${cwd} ./work/t1 admin=admin`,
      `claim ${cwd} ./work/t2 admin=admin`,
    ]);
  });

  it("chains each claim to its agent in the background, then one wait", () => {
    const script = waveScript([taskLines("claim", plan, "t1"), taskLines("resume", plan, "t2")]).split("\n");
    expect(script.slice(0, 2).every((l) => l.startsWith('ARTYFACT_ADMIN_TOKEN="$ADMIN_TOKEN" npx artyfact task ') && l.includes(" && { ( cd ./work/") && l.endsWith(" ) & }"))).toBe(true);
    expect(script.at(-1)).toBe("wait");
  });

  it("a failed claim never starts its agent; the other tasks still run", () => {
    const script = waveScript([taskLines("claim", plan, "t1"), taskLines("claim", plan, "t2")]);
    const { cwd, log } = runScript(script, "./work/t1");
    expect(log).toEqual([`agent ${cwd}/work/t2 admin=unset plain=unset`, `claim ${cwd} ./work/t1 admin=admin`, `claim ${cwd} ./work/t2 admin=admin`]);
  });

  it("a single task's two lines also leave the shell where it was", () => {
    const l = taskLines("claim", plan, "t1");
    const { cwd, finalDir } = runScript(`${l.claim}\n${l.agent}`);
    expect(finalDir).toBe(cwd);
  });
});
