import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/bootstrap.sh", import.meta.url));

describe("scripts/bootstrap.sh", () => {
  it("is valid bash", () => {
    expect(spawnSync("bash", ["-n", script]).status).toBe(0);
  });

  it("--dry-run prints the plan without side effects or tokens", () => {
    const r = spawnSync("bash", [script, "--dry-run"], { encoding: "utf8", env: { ...process.env, ACCOUNT_ID: "acct123" } });
    expect(r.status).toBe(0);
    for (const repo of ["kit-system", "kit-app"]) {
      expect(r.stdout).toContain(`wrangler artifacts repos create ${repo} --namespace artyfact`);
      expect(r.stdout).toContain(`https://acct123.artifacts.cloudflare.net/git/artyfact/${repo}.git`);
      expect(r.stdout).toContain(`issue-token ${repo} --namespace artyfact --scope write`);
    }
    expect(r.stdout).toContain("/api/systems/import");
    expect(r.stdout).not.toMatch(/Bearer [A-Za-z0-9]/);
  });

  it("never puts the write token on a process argv", () => {
    const text = readFileSync(script, "utf8");
    // The ps-visible forms: env(1) carrying GIT_CONFIG_*, and git's -c flag.
    expect(text.split("\n").filter((l) => /env .*GIT_CONFIG|git -c/.test(l))).toEqual([]);
    // Run authed_git against a git shim that records its argv and the header it received.
    const dir = mkdtempSync(join(tmpdir(), "artyfact-boot-"));
    const log = join(dir, "log");
    writeFileSync(join(dir, "git"), `#!/bin/sh\nprintf 'argv:%s\\n' "$*" >> ${log}\nprintf 'header:%s\\n' "$GIT_CONFIG_VALUE_0" >> ${log}\n`);
    chmodSync(join(dir, "git"), 0o755);
    const fn = text.slice(text.indexOf("authed_git() {"), text.indexOf("\n}\n", text.indexOf("authed_git() {")) + 2);
    const r = spawnSync("bash", ["-c", `${fn}\nauthed_git "$1" ls-remote https://x/repo.git`, "bash", "tok_secret_123"], {
      encoding: "utf8", env: { PATH: `${dir}:${process.env.PATH}` },
    });
    expect(r.status, r.stderr).toBe(0);
    const out = readFileSync(log, "utf8");
    expect(out).toContain("argv:ls-remote https://x/repo.git");
    expect(out).toContain("header:Authorization: Bearer tok_secret_123");
    expect(out.split("\n").filter((l) => l.startsWith("argv:")).join("\n")).not.toContain("tok_secret_123");
  });

  it("rejects unknown flags", () => {
    expect(spawnSync("bash", [script, "--nope"]).status).toBe(2);
  });
});
