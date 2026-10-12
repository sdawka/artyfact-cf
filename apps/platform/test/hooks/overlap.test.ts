import { describe, expect, it } from "vitest";
import { createSystemOne } from "@artyfact/semantic";
import type { CandidateRef, ConflictContext } from "../../worker/hooks/contract";
import { computeConflicts } from "../../worker/hooks/overlap";
import { loadGenome } from "../../worker/hooks/model-rules";
import { BASE, COMMIT, miniGenome, withRecipients } from "./fixtures";

const cand = (id: string, changedPaths: string[], changedNodes: string[], extra: Partial<CandidateRef> = {}): CandidateRef => ({
  id, realizationId: `realization.${id}`, evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE, changedPaths, changedNodes, ...extra,
});

const ctx = (candidate: CandidateRef, openCandidates: CandidateRef[]): ConflictContext => ({
  systemId: "system.mini-kit", candidate, genomeCommit: BASE, genomeFiles: miniGenome(), openCandidates,
});

describe("overlap / conflicts", () => {
  const base = loadGenome(miniGenome(), BASE);

  it("reports soft-semantic for shared nodes touched through disjoint files", async () => {
    const a = cand("cand.a", ["src/ui/people/AddContactDialog.tsx"], ["policy.ownerOnly", "screen.people"]);
    const b = cand("cand.b", ["src/worker/routes/contacts.ts"], ["policy.ownerOnly"]);
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "soft-semantic", candidates: ["cand.a", "cand.b"], nodes: ["policy.ownerOnly"], paths: [] });
    expect(r[0].subjects).toContain("policy.ownerOnly");
  });

  it("reports file when both change the same path", async () => {
    const a = cand("cand.a", ["src/ui/people.tsx", "src/a.ts"], ["screen.people"]);
    const b = cand("cand.b", ["src/ui/people.tsx"], ["screen.people"]);
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r).toEqual([expect.objectContaining({ kind: "file", paths: ["src/ui/people.tsx"], nodes: ["screen.people"] })]);
  });

  it("ignores platform-written files when looking for file conflicts", async () => {
    const a = cand("cand.a", ["TASK_PACKET.md", "AGENTS.md", ".artyfact/candidate.json", "src/ui/people.tsx"], ["screen.people"]);
    const b = cand("cand.b", ["TASK_PACKET.md", "AGENTS.md", ".artyfact/candidate.json", "src/ui/home.tsx"], ["screen.home"]);
    expect(await computeConflicts(ctx(a, [b]), base)).toEqual([]);
  });

  it("returns [] when nothing overlaps", async () => {
    const a = cand("cand.a", ["src/ui/people.tsx"], ["screen.people"]);
    const b = cand("cand.b", ["src/ui/home.tsx"], ["screen.home"]);
    expect(await computeConflicts(ctx(a, [b]), base)).toEqual([]);
  });

  it("ignores unmapped pseudo-nodes and same paths across different repos", async () => {
    const a = cand("cand.a", ["README.md"], ["unmapped:README.md"]);
    const b = cand("cand.b", ["README.md"], ["unmapped:README.md"], { target: "genome", genomeFiles: miniGenome() });
    expect(await computeConflicts(ctx(a, [b]), base)).toEqual([]);
  });

  it("attaches the System One interference judgment when a provider is given", async () => {
    const a = cand("cand.a", ["src/ui/a.tsx"], ["policy.ownerOnly"]);
    const b = cand("cand.b", ["src/worker/b.ts"], ["policy.ownerOnly"]);
    const r = await computeConflicts(ctx(a, [b]), base, { s1: createSystemOne({ FAKE_S1: "1" }) });
    // The fake's default rules interference out (noul 0.05); #s1harm would confirm it.
    expect(r[0].semantic).toMatchObject({ interferes: 0.05, verdict: "fail" });
    expect(r[0].semantic?.provenance.provider).toBe("fake");
  });

  it("reports hard-semantic when composing two valid Genome candidates yields a hard violation on a shared node", async () => {
    // A removes component.DueList (valid alone). B adds a criterion on component.DueList (valid alone).
    // Composed, the criterion's subject no longer exists: criterion.subjectMissing.
    const aFiles = { ...miniGenome() };
    aFiles["things/webapp/ontology.yaml"] = aFiles["things/webapp/ontology.yaml"].replace(
      "    children:\n      - { id: component.DueList, kind: component, name: Due list }\n", "\n");
    const bFiles = { ...miniGenome() };
    bFiles["things/webapp/criteria.yaml"] = bFiles["things/webapp/criteria.yaml"].replace("hooks:\n  - id: hook.webapp.screen.people", [
      "  - id: C.webapp.duelist",
      "    title: Due list shows due contacts",
      "    claim: The due list shows exactly the contacts that are due.",
      "    ownerKind: thing",
      "    ownerId: thing.webapp",
      "    subjectKind: component",
      "    subjectId: component.DueList",
      "    targetKind: artifact",
      "    gates: [candidate]",
      "hooks:",
      "  - id: hook.webapp.screen.people",
    ].join("\n"));
    expect(aFiles["things/webapp/ontology.yaml"]).not.toContain("component.DueList");
    expect(bFiles["things/webapp/criteria.yaml"]).toContain("C.webapp.duelist");
    const a = cand("cand.a", ["things/webapp/ontology.yaml"], [], { target: "genome", genomeFiles: aFiles });
    const b = cand("cand.b", ["things/webapp/criteria.yaml"], [], { target: "genome", genomeFiles: bFiles });
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("hard-semantic");
    expect(r[0].nodes).toContain("component.DueList");
    expect(r[0].message).toContain("criterion.subjectMissing");
  });

  it("notes, rather than hides, an open Genome candidate that does not load", async () => {
    const a = cand("cand.a", ["things/webapp/ontology.yaml"], [], { target: "genome", genomeFiles: withRecipients() });
    const b = cand("cand.b", ["things/webapp/ontology.yaml"], [], { target: "genome", genomeFiles: { ...miniGenome(), "system.yaml": "id: 1" } });
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r[0]).toMatchObject({ kind: "file", paths: ["things/webapp/ontology.yaml"] });
    expect(r[0].message).toMatch(/model delta unavailable for cand\.b/);
  });

  const dupCriterion = [
    "  - id: C.dup",
    "    title: Duplicate",
    "    claim: Declared twice once composed.",
    "    ownerKind: system",
    "    ownerId: system.mini-kit",
    "    subjectKind: screen",
    "    subjectId: screen.people",
    "    targetKind: model",
    "    gates: [candidate]",
  ].join("\n");
  const withDupIn = (files: Record<string, string>, path: string) => {
    const out = { ...files };
    out[path] = out[path].replace(/\nhooks:\n/, `\n${dupCriterion}\nhooks:\n`);
    if (out[path] === files[path]) throw new Error("mutation did not apply");
    return out;
  };

  it("a composed Genome that does not parse is hard-semantic (genome.parse)", async () => {
    const a = cand("cand.a", ["things/webapp/criteria.yaml"], [], { target: "genome", genomeFiles: withDupIn(miniGenome(), "things/webapp/criteria.yaml") });
    const b = cand("cand.b", ["criteria.yaml"], [], { target: "genome", genomeFiles: withDupIn(miniGenome(), "criteria.yaml") });
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("hard-semantic");
    expect(r[0].message).toContain("genome.parse:");
    expect(r[0].message).toMatch(/C\.dup/);
  });

  it("an unloadable open candidate with no shared paths or nodes still yields a soft-semantic report", async () => {
    const a = cand("cand.a", ["src/ui/people.tsx"], ["screen.people"]);
    const b = cand("cand.b", ["system.yaml"], [], { target: "genome", genomeFiles: { ...miniGenome(), "system.yaml": "id: 1\n" } });
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "soft-semantic", nodes: [], candidates: ["cand.a", "cand.b"] });
    expect(r[0].message).toMatch(/model delta unavailable for cand\.b/);
    expect(r[0].error).toMatch(/cand\.b/);
  });

  it("composes system/-prefixed file maps and changed paths in the same key space", async () => {
    const prefix = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [`system/${k}`, v]));
    const aFiles = { ...miniGenome() };
    aFiles["things/webapp/ontology.yaml"] = aFiles["things/webapp/ontology.yaml"].replace(
      "    children:\n      - { id: component.DueList, kind: component, name: Due list }\n", "\n");
    const bFiles = { ...miniGenome() };
    bFiles["things/webapp/criteria.yaml"] = bFiles["things/webapp/criteria.yaml"].replace("hooks:\n  - id: hook.webapp.screen.people", [
      "  - id: C.webapp.duelist", "    title: Due list", "    claim: Shows due contacts.", "    ownerKind: thing", "    ownerId: thing.webapp",
      "    subjectKind: component", "    subjectId: component.DueList", "    targetKind: artifact", "    gates: [candidate]",
      "hooks:", "  - id: hook.webapp.screen.people",
    ].join("\n"));
    const a = cand("cand.a", ["system/things/webapp/ontology.yaml"], [], { target: "genome", genomeFiles: prefix(aFiles) });
    const b = cand("cand.b", ["system/things/webapp/criteria.yaml"], [], { target: "genome", genomeFiles: prefix(bFiles) });
    const r = await computeConflicts({ ...ctx(a, [b]), genomeFiles: prefix(miniGenome()) }, base);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("hard-semantic");
    expect(r[0].message).toContain("criterion.subjectMissing");
  });

  it("an open Genome candidate without genomeFiles is reported, not dropped", async () => {
    const a = cand("cand.a", ["src/ui/people.tsx"], ["screen.people"]);
    const b = cand("cand.b", ["things/webapp/ontology.yaml"], [], { target: "genome" });
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "soft-semantic", nodes: [] });
    expect(r[0].message).toContain("genome files unavailable for cand.b");
    expect(r[0].error).toBeDefined();
  });
});
