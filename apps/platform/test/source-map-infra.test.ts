/// <reference types="vite/client" />
/** Template source-map defaults must cover app infrastructure so template upgrades are promotable. */
import { describe, expect, it } from "vitest";
import { createSystemOne } from "@artyfact/semantic";
import { loadSourceMap, nodesForPath, parseSourceMap } from "../worker/artifacts/source-map";
import type { CandidateRef, SubmissionContext } from "../worker/hooks/contract";
import { loadGenome } from "../worker/hooks/model-rules";
import { createHookRunner } from "../worker/hooks/run";
import { BASE, COMMIT, keepInTouch } from "./hooks/fixtures";

const defaultsText = Object.values(
  import.meta.glob("../../../packages/templates/thing/cloudflare-worker-webapp@1/source-map.defaults.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)[0];
const appMapText = Object.values(
  import.meta.glob("../../../examples/keep-in-touch-app/source-map.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)[0];
const scaffold = Object.keys(
  import.meta.glob(["../../../examples/keep-in-touch-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"], { query: "?url", eager: true }),
).map((p) => p.slice(p.indexOf("keep-in-touch-app/") + "keep-in-touch-app/".length));

const THING = "thing.webapp";
const sm = loadSourceMap(parseSourceMap(defaultsText), THING, appMapText);
const mapped = (p: string) => nodesForPath(sm, p).filter((n) => !n.startsWith("unmapped:"));

const INFRA = [
  "package.json", "package-lock.json", "tsconfig.json", "vitest.config.ts", "wrangler.jsonc", "wrangler.test.jsonc", ".gitignore",
  ".dev.vars.example", "src/index.ts", "src/worker/env.ts", "src/worker/phenome.ts", "test/phenome.test.ts", "public/index.html", "README.md",
  ".artyfact/template.json",
];

describe("template source-map defaults: app infrastructure", () => {
  it("maps every template-upgrade path to a node", () => {
    for (const p of INFRA) expect(mapped(p), p).not.toHaveLength(0);
    expect(mapped("package.json")).toEqual([THING]);
  });

  it("keeps the app's own mappings in the union", () => {
    expect(mapped("src/index.ts")).toEqual(expect.arrayContaining(["thing.webapp"]));
    expect(mapped("src/worker/routes/contacts.ts")).toEqual(expect.arrayContaining(["operation.contact.save", "policy.ownerOnly"]));
    expect(mapped("public/people/add-contact-dialog.js")).toEqual(expect.arrayContaining(["affordance.AddContactDialog.save"]));
  });

  it("maps every file the scaffold ships", () => {
    expect(scaffold.length).toBeGreaterThan(10);
    // source-map.yaml decides scope authorization, so it is intentionally unmapped: changing it blocks promotion until a human authorizes it.
    const unmapped = scaffold.filter((p) => mapped(p).length === 0);
    expect(unmapped).toEqual(["source-map.yaml"]);
    expect(mapped("src/worker/auth.ts")).toEqual(["policy.ownerOnly"]);
  });

  it("hook.system.promotion scope-authorized passes for an empty-scope upgrade touching only infrastructure", async () => {
    const changedPaths = INFRA.filter((p) => p !== ".artyfact/template.json").concat(".artyfact/template.json");
    const candidate: CandidateRef = {
      id: "cand.kit.r1", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE,
      changedPaths, changedNodes: [], pathNodes: Object.fromEntries(changedPaths.map((p) => [p, nodesForPath(sm, p)])),
    };
    const ctx: SubmissionContext = {
      systemId: "system.keep-in-touch", candidate, genomeCommit: BASE, genomeFiles: keepInTouch(),
      tree: changedPaths.map((path) => ({ path, size: 1 })),
      permittedPaths: ["**"], protectedPaths: ["system/**", "assays/**"], openCandidates: [],
    };
    expect(loadGenome(keepInTouch(), BASE)).toBeTruthy();
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: () => new Date(0) });
    const promo = (await runner.runSubmission(ctx)).find((e) => e.criterion === "C.system.promotion")!;
    expect(promo.observations).toContainEqual(expect.objectContaining({ check: "scope-authorized", verdict: "pass" }));
    // .artyfact/** stays reported as platform-written, not unmapped.
    const scope = (promo.observations as { check?: string; observations?: unknown[] }[]).find((o) => o.check === "scope-authorized");
    expect(JSON.stringify(scope)).toContain("platformWritten");
    expect(JSON.stringify(scope)).not.toContain("unmapped");
  });

  it.each(["src/worker/auth.ts", "source-map.yaml"])("scope-authorized does not pass for an app-Thing candidate changing %s without an app mapping", async (path) => {
    const defaultsOnly = loadSourceMap(parseSourceMap(defaultsText), THING, undefined);
    const candidate: CandidateRef = {
      id: "cand.kit.r1", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE,
      changedPaths: ["package.json", path], changedNodes: [THING],
      pathNodes: Object.fromEntries(["package.json", path].map((p) => [p, nodesForPath(defaultsOnly, p)])),
    };
    const ctx: SubmissionContext = {
      systemId: "system.keep-in-touch", candidate, genomeCommit: BASE, genomeFiles: keepInTouch(),
      tree: [{ path, size: 1 }], permittedPaths: ["**"], protectedPaths: ["system/**", "assays/**"], openCandidates: [],
    };
    const runner = createHookRunner({ s1: createSystemOne({ FAKE_S1: "1" }), now: () => new Date(0) });
    const promo = (await runner.runSubmission(ctx)).find((e) => e.criterion === "C.system.promotion")!;
    expect(promo.observations).toContainEqual(expect.objectContaining({ check: "scope-authorized", verdict: "unknown" }));
  });
});
