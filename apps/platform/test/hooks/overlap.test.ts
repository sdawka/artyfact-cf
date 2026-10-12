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
    expect(r[0].semantic).toMatchObject({ interferes: 0.95, verdict: "pass" });
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
});
