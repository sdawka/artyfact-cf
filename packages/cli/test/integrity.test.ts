import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.ts";

const cwd = mkdtempSync(join(tmpdir(), "artyfact-integrity-cli-"));
const token = "admin-secret-that-must-stay-out-of-files";
const genome = () => {
  const dir = join(cwd, `genome-${Math.random()}`);
  mkdirSync(join(dir, "intent"), { recursive: true });
  mkdirSync(join(dir, "artifact.platform"), { recursive: true });
  mkdirSync(join(dir, "evolutions"), { recursive: true });
  mkdirSync(join(dir, "evolutions/nested"), { recursive: true });
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "node.yaml"), "id: system.one\nkind: system\nfields: {name: One}\n");
  writeFileSync(join(dir, "artifact.platform/node.yaml"), "id: artifact.platform\nkind: artifact\nfields: {name: Platform}\n");
  writeFileSync(join(dir, "evolutions/evolution.one.yaml"), [
    "id: evolution.one", "title: One", "intent: Build one useful thing.", "state: proposed", "kind: implementation",
    "affectedNodes: []", "affectedClaims: []", "genomeDelta: []", "acceptanceCriteria: []", "requiredEvidence: []",
    "dependsOn: []", "risk: low", "realizations: []", "",
  ].join("\n"));
  writeFileSync(join(dir, "evolutions/nested/node.yaml"), "secret: do-not-upload-nested\n");
  writeFileSync(join(dir, "intent/brief.md"), "# Intent\n\nBuild one useful thing.\n");
  writeFileSync(join(dir, "intent/manifest.json"), '{"version":1,"nodes":[]}\n');
  writeFileSync(join(dir, "secrets.yaml"), "api_token: do-not-upload\n");
  writeFileSync(join(dir, "config/unrelated.yml"), "private: unrelated-config\n");
  return dir;
};
const section = (status: string) => ({ status, complete: true, findings: [], checkedSubjects: [], checkedRelationships: [], limitations: [] });
const report = (status: "passed" | "blocked" | "needs-review") => ({
  version: 1, id: `report.${status}`, systemId: "system.one", snapshotHash: "sha256:one", policyVersion: "integrity.v1", createdAt: "2026-10-14T00:00:00Z", status,
  structural: section(status === "blocked" ? "blocked" : "passed"),
  semantic: { ...section(status), intentFidelity: "checked", provenance: { provider: "jev", model: "jev", questions: ["semantic.vague"], thresholds: { confident: 0.8, review: 0.5 }, budget: { requestedCalls: 1, maxCalls: 1, usedCalls: 1 }, truncated: false, fake: false, retries: 0 } },
});
const snapshot = (files: Record<string, string>) => ({ version: 1, id: "snapshot.one", createdAt: "2026-10-14T00:00:00Z", kind: "initial-preview", systemId: "system.one", hash: "sha256:one", genomeHash: "sha256:g", files, intent: { hash: "sha256:i", issues: [], fidelity: "checked", documents: [] }, templateClosure: [], templateClosureHash: "sha256:t", staticFindings: [] });
const run = (status: "passed" | "blocked" | "needs-review") => ({ id: "run.one", systemId: "system.one", state: "completed", snapshotId: "snapshot.one", snapshotHash: "sha256:one", provider: "jev", requestedCalls: 1, attempt: 1, createdAt: "2026-10-14T00:00:00Z", updatedAt: "2026-10-14T00:00:01Z", report: report(status), reviewUrl: "http://localhost:1337/start?system=system.one&integrity=run.one" });
const invoke = async (args: string[]) => {
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { cwd, env: { ARTYFACT_ADMIN_TOKEN: token }, pollMs: 0, out: s => out.push(s), err: s => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};

afterEach(() => vi.unstubAllGlobals());

describe("ontology integrity CLI", () => {
  it.each([["passed", 0], ["blocked", 1], ["needs-review", 2]] as const)("returns the %s full-check exit", async (status, code) => {
    const dir = genome(), files = {
      "artifact.platform/node.yaml": readFileSync(join(dir, "artifact.platform/node.yaml"), "utf8"),
      "evolutions/evolution.one.yaml": readFileSync(join(dir, "evolutions/evolution.one.yaml"), "utf8"),
      "intent/brief.md": readFileSync(join(dir, "intent/brief.md"), "utf8"),
      "intent/manifest.json": readFileSync(join(dir, "intent/manifest.json"), "utf8"),
      "node.yaml": readFileSync(join(dir, "node.yaml"), "utf8"),
    };
    const calls: Array<{ url: string; body?: unknown; auth: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: new Headers(init?.headers).get("authorization") });
      if (url.endsWith("/integrity/preview")) return Response.json({ snapshot: snapshot(files) }, { status: 201 });
      if (url.endsWith("/integrity/runs")) return Response.json({ run: { ...run(status), state: "queued", report: undefined } }, { status: 202 });
      return Response.json({ run: run(status) });
    }));
    const result = await invoke(["ontology", "check", "--system", "system.one", "--genome", dir, "--provider", "jev", "--max-calls", "1", "--platform", "http://localhost:1337", "--json"]);
    expect(result).toMatchObject({ code, err: "" });
    expect(JSON.parse(result.out)).toMatchObject({ status, exitCode: code, snapshot: { files }, run: { id: "run.one" } });
    expect(calls.map(call => call.url)).toEqual([
      "http://localhost:1337/api/systems/system.one/integrity/preview",
      "http://localhost:1337/api/systems/system.one/integrity/runs",
      "http://localhost:1337/api/systems/system.one/integrity/runs/run.one",
    ]);
    expect(calls[0]).toEqual({
      url: "http://localhost:1337/api/systems/system.one/integrity/preview",
      body: { files },
      auth: `Bearer ${token}`,
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain("do-not-upload");
    expect(JSON.stringify(calls[0]?.body)).not.toContain("unrelated-config");
    expect(JSON.stringify(calls[0]?.body)).not.toContain("do-not-upload-nested");
    expect(calls[1]?.body).toEqual({ snapshotId: "snapshot.one", provider: "jev", budget: { maxCalls: 1 } });
    expect(result.out).not.toContain(token);
  });

  it.each([
    ["pending", { ...run("needs-review"), state: "running", report: undefined }],
    ["provider off", { ...run("needs-review"), provider: "off", report: { ...report("needs-review"), semantic: { ...report("needs-review").semantic, provenance: { ...report("needs-review").semantic.provenance, provider: "off" } } } }],
  ])("reports %s checks as needs-review without claiming a pass", async (_label, checkedRun) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ run: checkedRun })));
    const result = await invoke(["ontology", "check", "--system", "system.one", "--run", "run.one", "--platform", "http://localhost:1337", "--json"]);
    expect(result.code).toBe(2);
    const output = JSON.parse(result.out);
    expect(output).toMatchObject({ status: "needs-review", exitCode: 2 });
    expect(output.status).not.toBe("passed");
  });

  it("keeps transport failures explicit instead of returning an integrity result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("connection refused"); }));
    const result = await invoke(["ontology", "check", "--system", "system.one", "--run", "run.one", "--platform", "http://localhost:1337", "--json"]);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("cannot reach platform");
    expect(result.err).toContain("connection refused");
  });

  it("records agreement then materializes the exact sanitized snapshot without credentials", async () => {
    const files = { "node.yaml": "id: system.one\nkind: system\n", "intent/brief.md": "# Intent\n", "intent/manifest.json": '{"version":1,"nodes":[]}\n' };
    const envelope = join(cwd, `snapshot-${Math.random()}.json`), dispositions = join(cwd, `dispositions-${Math.random()}.json`), destination = join(cwd, `materialized-${Math.random()}`);
    writeFileSync(envelope, JSON.stringify({ snapshot: snapshot(files), run: run("needs-review") }));
    writeFileSync(dispositions, JSON.stringify({ dispositions: [{ findingId: "finding.one", decision: "accepted", rationale: "Reviewed against the intent." }] }));
    const agreed = { ...run("needs-review"), agreement: { status: "accepted-with-dispositions", actor: "admin", at: "2026-10-14T00:00:02Z", reportId: "report.needs-review", snapshotHash: "sha256:one", dispositions: [], eligibility: { eligible: true, status: "accepted-with-dispositions", unresolvedFindingIds: [] } } };
    const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ run: agreed });
    }));
    const accepted = await invoke(["ontology", "agreement", "run.one", "--system", "system.one", "--file", dispositions, "--snapshot", envelope, "--platform", "http://localhost:1337"]);
    expect(accepted).toMatchObject({ code: 0, err: "" });
    expect(calls).toEqual([{ url: "http://localhost:1337/api/systems/system.one/integrity/runs/run.one/agreement", body: { dispositions: [{ findingId: "finding.one", decision: "accepted", rationale: "Reviewed against the intent." }] }, auth: `Bearer ${token}` }]);
    expect(readFileSync(envelope, "utf8")).not.toContain(token);
    expect(JSON.parse(readFileSync(envelope, "utf8"))).toMatchObject({ run: { agreement: { status: "accepted-with-dispositions" } } });
    const materialized = await invoke(["ontology", "materialize", "--file", envelope, "--dir", destination, "--prepare-only"]);
    expect(materialized).toMatchObject({ code: 0, err: "" });
    for (const [path, content] of Object.entries(files)) expect(readFileSync(join(destination, "genome", path), "utf8")).toBe(content);
    expect(existsSync(join(destination, "app"))).toBe(false);
  });

  it("refuses unsafe agreed snapshot paths before writing", async () => {
    const envelope = join(cwd, `unsafe-${Math.random()}.json`), destination = join(cwd, `unsafe-out-${Math.random()}`);
    const unsafeSnapshot = snapshot({ "node.yaml": "id: system.one\nkind: system\n", "../secret": "x" });
    const agreedRun = { ...run("passed"), agreement: { status: "accepted", actor: "admin", at: "2026-10-14T00:00:02Z", reportId: "report.passed", snapshotHash: "sha256:one", dispositions: [], eligibility: { eligible: true, status: "accepted", unresolvedFindingIds: [] } } };
    writeFileSync(envelope, JSON.stringify({ snapshot: unsafeSnapshot, run: agreedRun }));
    const result = await invoke(["ontology", "materialize", "--file", envelope, "--dir", destination, "--prepare-only"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("unsafe");
    expect(existsSync(destination)).toBe(false);
  });
});
