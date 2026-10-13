/// <reference types="vite/client" />
/** Node `files` (template defaults plus Peopling's own) must cover app infrastructure so template upgrades are promotable. */
import { describe, expect, it } from "vitest";
import { createSystemOne } from "@artyfact/semantic";
import { buildGenome } from "../worker/artifacts/genome-source";
import { nodesForPath, sourceMapFor } from "../worker/artifacts/source-map";
import { buildTaskPacket } from "../worker/packets/task-packet";
import type { CandidateRef, SubmissionContext } from "../worker/hooks/contract";
import { loadGenome } from "../worker/hooks/model-rules";
import { createHookRunner } from "../worker/hooks/run";
import { BASE, COMMIT, peopling } from "./hooks/fixtures";

const scaffold = Object.keys(
  import.meta.glob(["../../../examples/peopling-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"], { query: "?url", eager: true }),
).map((p) => p.slice(p.indexOf("peopling-app/") + "peopling-app/".length));

const THING = "thing.webapp";
const sm = sourceMapFor(loadGenome(peopling(), BASE));
/** Peopling with every node's own `files` removed: only the template defaults map paths. */
const withoutNodeFiles = () => Object.fromEntries(Object.entries(peopling()).map(([p, t]) => [p, t.replace(/^files:\n(  - .*\n)+/m, "")]));
const mapped = (p: string) => nodesForPath(sm, p).filter((n) => !n.startsWith("unmapped:"));

const INFRA = [
  "package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "wrangler.jsonc", "wrangler.test.jsonc", ".gitignore",
  ".dev.vars.example", "src/index.ts", "src/worker/env.ts", "src/worker/phenome.ts", "test/phenome.test.ts", "public/index.html", "README.md",
  ".artyfact/template.json",
];

describe("node files: app infrastructure", () => {
  it("maps every template-upgrade path to a node", () => {
    for (const p of INFRA) expect(mapped(p), p).not.toHaveLength(0);
    expect(mapped("package.json")).toEqual([THING]);
  });

  it("keeps the nodes' own files in the union", () => {
    expect(mapped("src/index.ts")).toEqual(expect.arrayContaining(["thing.webapp"]));
    expect(mapped("src/worker/routes/contacts.ts")).toEqual(expect.arrayContaining(["operation.contact.save", "policy.ownerOnly"]));
    expect(mapped("public/people/add-contact-dialog.js")).toEqual(expect.arrayContaining(["affordance.AddContactDialog.save"]));
  });

  it("maps every file the scaffold ships", () => {
    expect(scaffold.length).toBeGreaterThan(10);
    expect(scaffold.filter((p) => mapped(p).length === 0)).toEqual([]);
    expect(mapped("src/worker/auth.ts")).toEqual(["policy.ownerOnly"]);
  });

  it("hook.system.promotion scope-authorized passes for an empty-scope upgrade touching only infrastructure", async () => {
    const changedPaths = INFRA.filter((p) => p !== ".artyfact/template.json").concat(".artyfact/template.json");
    const candidate: CandidateRef = {
      id: "cand.peopling.r1", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE,
      changedPaths, changedNodes: [], pathNodes: Object.fromEntries(changedPaths.map((p) => [p, nodesForPath(sm, p)])),
    };
    const ctx: SubmissionContext = {
      systemId: "system.peopling", candidate, genomeCommit: BASE, genomeFiles: peopling(),
      tree: changedPaths.map((path) => ({ path, size: 1 })),
      permittedPaths: ["**"], protectedPaths: ["system/**", "assays/**"], openCandidates: [],
    };
    expect(loadGenome(peopling(), BASE)).toBeTruthy();
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: () => new Date(0) });
    const promo = (await runner.runSubmission(ctx)).find((e) => e.criterion === "C.system.promotion")!;
    expect(promo.observations).toContainEqual(expect.objectContaining({ check: "scope-authorized", verdict: "pass" }));
    // .artyfact/** stays reported as platform-written, not unmapped.
    const scope = (promo.observations as { check?: string; observations?: unknown[] }[]).find((o) => o.check === "scope-authorized");
    expect(JSON.stringify(scope)).toContain("platformWritten");
    expect(JSON.stringify(scope)).not.toContain("unmapped");
  });

  it("scope-authorized does not pass for an app-Thing candidate changing src/worker/auth.ts without a node mapping", async () => {
    const path = "src/worker/auth.ts";
    const defaultsOnly = sourceMapFor(loadGenome(withoutNodeFiles(), BASE));
    const candidate: CandidateRef = {
      id: "cand.peopling.r1", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE,
      changedPaths: ["package.json", path], changedNodes: [THING],
      pathNodes: Object.fromEntries(["package.json", path].map((p) => [p, nodesForPath(defaultsOnly, p)])),
    };
    const ctx: SubmissionContext = {
      systemId: "system.peopling", candidate, genomeCommit: BASE, genomeFiles: peopling(),
      tree: [{ path, size: 1 }], permittedPaths: ["**"], protectedPaths: ["system/**", "assays/**"], openCandidates: [],
    };
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: () => new Date(0) });
    const promo = (await runner.runSubmission(ctx)).find((e) => e.criterion === "C.system.promotion")!;
    expect(promo.observations).toContainEqual(expect.objectContaining({ check: "scope-authorized", verdict: "unknown" }));
  });
});

describe("task packet from the committed example", () => {
  it("permits the affected nodes' files", async () => {
    const { model } = buildGenome(new Map(Object.entries(peopling()).filter(([p]) => p.endsWith(".yaml"))), BASE);
    const evolution = { ...model.evolutions[0]!, affectedNodes: ["operation.contact.save"] };
    const p = await buildTaskPacket({
      systemId: "system.peopling", realizationId: "realization.1.r1", target: "app", model, evolution,
      workspace: { repo: "peopling.app", fork: "peopling.app--r1", baseCommit: "a".repeat(40), remote: "https://acc.artifacts.cloudflare.net/git/artyfact/peopling.app--r1.git" },
      baseTreePaths: scaffold, commands: ["npm test"], concurrentWork: [], platformUrl: "http://localhost:1337",
    });
    expect(p.permittedPaths).toContain("src/worker/routes/contacts.ts");
    expect(p.permittedPaths).not.toContain("**");
  });
});
