import { describe, expect, it } from "vitest";
import { buildGenome } from "../worker/artifacts/genome-source";
import { loadSourceMap } from "../worker/artifacts/source-map";
import { buildTaskPacket, requiredCriteria, type PacketInput } from "../worker/packets/task-packet";
import { gateCriteria } from "../worker/promotion";
import { appFiles, genomeFiles } from "./fixtures/genome";

const genome = buildGenome(new Map(Object.entries(genomeFiles).filter(([p]) => p.endsWith(".yaml"))), "g1");
const evolution = genome.model.evolutions.find((e) => e.id === "evolution.1")!;
const tpl = genome.model.templates.find((t) => t.id === "template.thing.cloudflare-worker-webapp")!;

function input(over: Partial<PacketInput> = {}): PacketInput {
  return {
    systemId: "system.kit",
    realizationId: "realization.1.r1",
    target: "app",
    model: genome.model,
    evolution,
    workspace: { repo: "kit-app", fork: "kit-app--r1", baseCommit: "a".repeat(40), remote: "https://acc.artifacts.cloudflare.net/git/artyfact/kit-app--r1.git" },
    sourceMap: loadSourceMap(tpl.sourceMapDefaults, "thing.webapp", appFiles["source-map.yaml"]),
    baseTreePaths: Object.keys(appFiles),
    commands: ["npm install", "npm run dev", "npm test"],
    concurrentWork: [],
    platformUrl: "http://localhost:5173",
    ...over,
  };
}

describe("task packet", () => {
  it("carries acceptance criteria with gate flags", async () => {
    const p = await buildTaskPacket(input());
    expect(p.acceptanceCriteria.map((c) => [c.id, c.gate])).toEqual([["C.people.list", true], ["C.people.sorted", false], ["C.people.later", false]]);
    expect(p.acceptanceCriteria[0]).toMatchObject({ title: "People screen lists contacts", subject: "screen.people", hooks: ["hook.people.list"] });
  });

  it("derives permitted globs from the source map and protects system/assays", async () => {
    const p = await buildTaskPacket(input());
    expect(p.permittedPaths.sort()).toEqual(["src/ui/**", "src/ui/people/**"]);
    expect(p.protectedPaths).toEqual(["system/**", "assays/**"]);
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
    expect(JSON.stringify(p)).not.toMatch(/secret|Bearer/);
  });

  it("carries the CLI start line with a token placeholder", async () => {
    const p = await buildTaskPacket(input());
    const line = "ARTYFACT_TOKEN=<token> npx artyfact start realization.1.r1 --system system.kit --evolution evolution.1 --dir ./realization.1.r1";
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
    expect(p.permittedPaths).toEqual(["things/webapp/ontology.yaml", "evolutions/**"]);
    expect(p.protectedPaths).toEqual(["assays/**"]);
  });
});

describe("gate criteria", () => {
  it("blocking = hard with a bound hook; the rest are advisories", () => {
    expect(requiredCriteria(genome.model, evolution)).toEqual(["C.people.list"]);
    const ref = { id: "candidate.x", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app" as const, commit: "c", baseCommit: "b", changedPaths: [], changedNodes: ["screen.people"] };
    const gates = gateCriteria(genome.model, ref);
    expect(gates.filter((g) => g.blocking).map((g) => g.id).sort()).toEqual(["C.people.list", "C.system.promotion"]);
    expect(gates.filter((g) => !g.blocking).map((g) => g.id)).toContain("C.people.sorted");
  });
});
