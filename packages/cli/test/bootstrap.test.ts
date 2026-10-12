import { spawnSync } from "node:child_process";
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

  it("rejects unknown flags", () => {
    expect(spawnSync("bash", [script, "--nope"]).status).toBe(2);
  });
});
