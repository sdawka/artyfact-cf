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
  systemId: "system.mini-peopling", candidate, genomeCommit: BASE, genomeFiles: miniGenome(), openCandidates,
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

  const ACCOUNT = "thing.webapp/section.domain/entity.Account/node.yaml";
  const LIST = "thing.webapp/section.domain/operation.contact.list/node.yaml";
  // A removes entity.Account (valid alone). B makes operation.contact.list read it (valid alone).
  // Composed, B's link points at nothing: a dangling reference.
  const removeAccount = (files: Record<string, string>) => {
    const out = { ...files };
    delete out[ACCOUNT];
    return out;
  };
  const readAccount = (files: Record<string, string>) => {
    const out = { ...files, [LIST]: files[LIST].replace("  - { rel: reads, to: entity.ContactRecord }\n", "  - { rel: reads, to: entity.ContactRecord }\n  - { rel: reads, to: entity.Account }\n") };
    if (out[LIST] === files[LIST]) throw new Error("mutation did not apply");
    return out;
  };

  it("reports hard-semantic when composing two valid Genome candidates yields a hard violation on a shared node", async () => {
    const a = cand("cand.a", [ACCOUNT], [], { target: "genome", genomeFiles: removeAccount(miniGenome()) });
    const b = cand("cand.b", [LIST], [], { target: "genome", genomeFiles: readAccount(miniGenome()) });
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("hard-semantic");
    expect(r[0].nodes).toContain("operation.contact.list");
    expect(r[0].message).toContain("ref.dangling");
  });

  it("notes, rather than hides, an open Genome candidate that does not load", async () => {
    const a = cand("cand.a", [ACCOUNT], [], { target: "genome", genomeFiles: withRecipients() });
    const b = cand("cand.b", [ACCOUNT], [], { target: "genome", genomeFiles: { ...miniGenome(), "node.yaml": "id: 1" } });
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r[0]).toMatchObject({ kind: "file", paths: [ACCOUNT] });
    expect(r[0].message).toMatch(/model delta unavailable for cand\.b/);
  });

  // The same criterion id declared on two nodes: each candidate loads, the composed tree does not.
  const dupCriterion = "criteria:\n  - id: C.dup\n    title: Duplicate\n    claim: Declared twice once composed.\n";
  const withDupIn = (files: Record<string, string>, path: string) => ({ ...files, [path]: `${files[path]}${dupCriterion}` });

  it("a composed Genome that does not parse is hard-semantic (genome.parse)", async () => {
    const a = cand("cand.a", [ACCOUNT], [], { target: "genome", genomeFiles: withDupIn(miniGenome(), ACCOUNT) });
    const b = cand("cand.b", [LIST], [], { target: "genome", genomeFiles: withDupIn(miniGenome(), LIST) });
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("hard-semantic");
    expect(r[0].message).toContain("genome.parse:");
    expect(r[0].message).toMatch(/C\.dup/);
  });

  it("an unloadable open candidate with no shared paths or nodes still yields a soft-semantic report", async () => {
    const a = cand("cand.a", ["src/ui/people.tsx"], ["screen.people"]);
    const b = cand("cand.b", ["node.yaml"], [], { target: "genome", genomeFiles: { ...miniGenome(), "node.yaml": "id: 1\n" } });
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "soft-semantic", nodes: [], candidates: ["cand.a", "cand.b"] });
    expect(r[0].message).toMatch(/model delta unavailable for cand\.b/);
    expect(r[0].error).toMatch(/cand\.b/);
  });

  it("composes system/-prefixed file maps and changed paths in the same key space", async () => {
    const prefix = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [`system/${k}`, v]));
    const a = cand("cand.a", [`system/${ACCOUNT}`], [], { target: "genome", genomeFiles: prefix(removeAccount(miniGenome())) });
    const b = cand("cand.b", [`system/${LIST}`], [], { target: "genome", genomeFiles: prefix(readAccount(miniGenome())) });
    const r = await computeConflicts({ ...ctx(a, [b]), genomeFiles: prefix(miniGenome()) }, base);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("hard-semantic");
    expect(r[0].message).toContain("ref.dangling");
  });

  it("an open Genome candidate without genomeFiles is reported, not dropped", async () => {
    const a = cand("cand.a", ["src/ui/people.tsx"], ["screen.people"]);
    const b = cand("cand.b", [LIST], [], { target: "genome" });
    const r = await computeConflicts(ctx(a, [b]), base);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "soft-semantic", nodes: [] });
    expect(r[0].message).toContain("genome files unavailable for cand.b");
    expect(r[0].error).toBeDefined();
  });
});
