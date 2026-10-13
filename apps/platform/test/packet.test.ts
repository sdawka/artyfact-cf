import { describe, expect, it } from "vitest";
import { buildGenome } from "../worker/artifacts/genome-source";
import { nodesForPath, sourceMapFor } from "../worker/artifacts/source-map";
import { diffScope } from "../worker/hooks/diff-scope";
import { buildTaskPacket, requiredCriteria, type PacketInput } from "../worker/packets/task-packet";
import { gateCriteria } from "../worker/promotion";
import { packetThing } from "../worker/service";
import { appFiles, genomeFiles } from "./fixtures/genome";

const genome = buildGenome(new Map(Object.entries(genomeFiles).filter(([p]) => p.endsWith(".yaml"))), "g1");
const evolution = genome.model.evolutions.find((e) => e.id === "evolution.1")!;

function input(over: Partial<PacketInput> = {}): PacketInput {
  return {
    systemId: "system.kit",
    realizationId: "realization.1.r1",
    target: "app",
    model: genome.model,
    evolution,
    workspace: { repo: "kit-app", fork: "kit-app--r1", baseCommit: "a".repeat(40), remote: "https://acc.artifacts.cloudflare.net/git/artyfact/kit-app--r1.git" },
    baseTreePaths: Object.keys(appFiles),
    commands: ["npm install", "npm run dev", "npm test"],
    concurrentWork: [],
    platformUrl: "http://localhost:1337",
    ...over,
  };
}

describe("task packet", () => {
  it("carries acceptance criteria with gate flags", async () => {
    const p = await buildTaskPacket(input());
    expect(p.acceptanceCriteria.map((c) => [c.id, c.gate])).toEqual([["C.people.list", true], ["C.people.sorted", false], ["C.people.later", false]]);
    expect(p.acceptanceCriteria[0]).toMatchObject({ title: "People screen lists contacts", subject: "screen.people", hooks: ["hook.people.list"] });
  });

  it("derives permitted globs from the affected nodes' files and protects system/assays", async () => {
    const p = await buildTaskPacket(input());
    expect(p.permittedPaths.sort()).toEqual(["src/ui/**", "src/ui/people/**"]);
    expect(p.protectedPaths).toEqual(["system/**", "assays/**"]);
  });

  it("treats an empty scope as unconstrained, still refusing protected paths", async () => {
    const unscoped = { ...evolution, affectedNodes: [] };
    const g = await buildTaskPacket(input({ target: "genome", evolution: unscoped }));
    expect(g.permittedPaths).toEqual(["**"]);
    const scope = (target: "app" | "genome", p: { permittedPaths: string[]; protectedPaths: string[] }, changedPaths: string[]) =>
      diffScope({ target, changedPaths, changedNodes: [], permitted: p.permittedPaths, protected: p.protectedPaths }).verdict;
    expect(scope("genome", g, ["things/webapp/ontology.yaml"])).toBe("pass");
    expect(scope("genome", g, ["assays/hooks.yaml"])).toBe("fail");
    expect((await buildTaskPacket(input({ target: "genome", evolution: unscoped, genomePrefix: "system/" }))).permittedPaths).toEqual(["system/**"]);
    const a = await buildTaskPacket(input({ evolution: unscoped }));
    expect(a.permittedPaths).toEqual(["**"]);
    expect(scope("app", a, ["system/things/webapp/ontology.yaml"])).toBe("fail");
  });

  it("lists entry files with certainty", async () => {
    const p = await buildTaskPacket(input());
    expect(p.entryFiles).toContainEqual({ path: "src/ui/people/index.html", certainty: "declared" });
  });

  it("excerpts affected nodes with their containment path and touching journeys", async () => {
    const p = await buildTaskPacket(input());
    const ex = p.genomeExcerpts.find((e) => e.id === "screen.people")!;
    expect(ex.path).toEqual(["system.kit", "thing.webapp", "section.ui", "screen.people"]);
    expect(ex.body).toContain("route: /people");
    expect(p.journeys.map((j) => j.id)).toEqual(["J.add"]);
    expect(p.commitments).toEqual(["Contacts are private to their owner"]);
  });

  it("renders markdown and an AGENTS.md block without any token", async () => {
    const p = await buildTaskPacket(input());
    expect(p.markdown).toContain("# Task Packet: List people");
    expect(p.markdown).toContain("C.people.list");
    expect(p.markdown).toContain("src/ui/people/**");
    expect(p.agentsMd).toContain("You are realizing evolution.1 for system.kit");
    expect(p.agentsMd).toContain("npx artyfact submit");
    // App realizations learn how to report a preview when CI did not build their submit.
    expect(p.submitInstructions).toContain("Report a preview");
    expect(p.markdown).toContain("npx artyfact build-report --status passed --url <preview-url>");
    expect(p.markdown).toContain("/api/systems/system.kit/realizations/realization.1.r1/builds");
    expect(p.agentsMd).toContain("npx artyfact build-report");
    // Only placeholders: no bearer header and no workspace secret.
    expect(JSON.stringify(p)).not.toMatch(/Bearer/);
    expect(p.workspace).not.toHaveProperty("secret");
  });

  it("carries the CLI start line with a token placeholder", async () => {
    const p = await buildTaskPacket(input());
    const line = "ARTYFACT_TOKEN=<token> ARTYFACT_SECRET=<secret> npx artyfact start realization.1.r1 --system system.kit --evolution evolution.1 --dir ./realization.1.r1";
    expect(p.startCommand).toBe(line);
    expect(p.markdown).toContain(`## Start`);
    expect(p.markdown).toContain(line);
  });

  it("has a stable hash that changes with content", async () => {
    const a = await buildTaskPacket(input());
    const b = await buildTaskPacket(input());
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.hash).toBe(a.hash);
    const c = await buildTaskPacket(input({ concurrentWork: [{ realization: "realization.1.r2", status: "working", changedSubjects: [] }] }));
    expect(c.hash).not.toBe(a.hash);
  });

  it("genome targets permit the affected nodes' Genome files", async () => {
    const evo2 = genome.model.evolutions.find((e) => e.id === "evolution.2")!;
    const p = await buildTaskPacket(input({ target: "genome", evolution: evo2, workspace: { ...input().workspace, repo: "kit-system", fork: "kit-system--r2" } }));
    expect(p.permittedPaths).toEqual(["thing.webapp/section.domain/entity.ContactRecord/**", "evolutions/**"]);
    expect(p.protectedPaths).toEqual(["assays/**"]);
  });
});

describe("gate criteria", () => {
  it("blocking = hard with a bound hook; the rest are advisories", () => {
    expect(requiredCriteria(genome.model, evolution)).toEqual(["C.people.list"]);
    const ref = { id: "candidate.x", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app" as const, commit: "c", baseCommit: "b", changedPaths: [], changedNodes: ["screen.people"] };
    const gates = gateCriteria(genome.model, evolution, ref);
    // Pool = acceptance ∪ promotion-gated. C.people.list (acceptance, gated only on submission) blocks;
    // C.people.audit ([promotion] only, bound) blocks; C.people.lint ([submission] only, bound, not acceptance) is not in the gate.
    expect(gates.filter((g) => g.blocking).map((g) => g.id).sort()).toEqual(["C.people.audit", "C.people.list", "C.system.promotion", "C.webapp.exists"]);
    expect(gates.map((g) => g.id)).not.toContain("C.people.lint");
    expect(gateCriteria(genome.model, { acceptanceCriteria: ["C.not.in.genome"] }, ref).find((g) => g.id === "C.not.in.genome")).toEqual({ id: "C.not.in.genome", severity: "hard", blocking: true });
    expect(gates.filter((g) => !g.blocking).map((g) => g.id)).toContain("C.people.sorted");
  });

  it("a hard acceptance criterion whose only hook is binding: defined is in the pool but not blocking", () => {
    const files = Object.entries(genomeFiles).filter(([p]) => p.endsWith(".yaml")).map(([p, t]) =>
      [p, p === "thing.webapp/section.ui/screen.people/node.yaml" ? t.replace(/(id: hook\.people\.lint[\s\S]*?binding: )bound/, "$1defined") : t] as [string, string]);
    const g = buildGenome(new Map(files), "g2");
    const ref = { id: "candidate.x", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app" as const, commit: "c", baseCommit: "b", changedPaths: [], changedNodes: [] };
    const gates = gateCriteria(g.model, { acceptanceCriteria: ["C.people.lint"] }, ref);
    expect(gates.find((x) => x.id === "C.people.lint")).toEqual({ id: "C.people.lint", severity: "hard", blocking: false });
  });
});

describe("node-attached source map: two Things with different roots", () => {
  const files = new Map(Object.entries(genomeFiles).filter(([p]) => p.endsWith(".yaml")));
  const web = files.get("thing.webapp/node.yaml")!;
  files.set("thing.webapp/node.yaml", web.replace("template: template.thing.cloudflare-worker-webapp@1\n", "template: template.thing.cloudflare-worker-webapp@1\nroot: apps/web\n"));
  files.set("thing.admin/node.yaml", "id: thing.admin\nkind: thing\ntemplate: template.thing.cloudflare-worker-service@1\nroot: apps/admin\nfields: {name: Admin}\n");
  files.set("thing.admin/screen.audit/node.yaml", "id: screen.audit\nkind: screen\nfields: {name: Audit}\nfiles: [src/ui/audit/**]\n");
  const two = buildGenome(files, "g2").model;
  const sm = sourceMapFor(two);

  it("prefixes each Thing's globs with its own root", () => {
    expect(nodesForPath(sm, "apps/web/src/ui/people/list.html").sort()).toEqual(["component.AddContactDialog", "screen.people", "section.ui"]);
    expect(nodesForPath(sm, "apps/web/package.json")).toEqual(["thing.webapp"]);
    expect(nodesForPath(sm, "apps/admin/package.json")).toEqual(["thing.admin"]);
    expect(nodesForPath(sm, "apps/admin/src/ui/audit/log.html")).toEqual(["screen.audit"]);
    expect(nodesForPath(sm, "src/ui/people/list.html")).toEqual(["unmapped:src/ui/people/list.html"]);
  });

  it("scopes a packet to the affected Thing's root", async () => {
    const p = await buildTaskPacket(input({ model: two, evolution: { ...evolution, affectedNodes: ["screen.people"] } }));
    expect(p.permittedPaths.sort()).toEqual(["apps/web/src/ui/**", "apps/web/src/ui/people/**"]);
    const q = await buildTaskPacket(input({ model: two, evolution: { ...evolution, affectedNodes: ["screen.audit"] } }));
    expect(q.permittedPaths).toEqual(["apps/admin/src/ui/audit/**"]);
  });

  it("works in the Thing that owns the affected nodes, and refuses a scope spanning two Things", () => {
    expect(packetThing(two, ["screen.audit"])?.id).toBe("thing.admin");
    expect(packetThing(two, ["screen.people", "P1"])?.id).toBe("thing.webapp");
    expect(packetThing(two, [])?.id).toBe("thing.webapp");
    expect(() => packetThing(two, ["screen.people", "screen.audit"])).toThrow(/several Things \(thing\.admin, thing\.webapp\)/);
  });
});
