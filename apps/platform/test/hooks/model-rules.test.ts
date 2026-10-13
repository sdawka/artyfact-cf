import { describe, expect, it } from "vitest";
import { genomeRoot, loadGenome, modelRules, packMatches, selectableRules } from "../../worker/hooks/model-rules";
import { engineRules, engineRun } from "../../worker/hooks/engine-gates";
import { miniGenome, withRecipients } from "./fixtures";

describe("model-rules engine", () => {
  const base = loadGenome(miniGenome(), "base");

  it("passes the valid mini-Genome", () => {
    const r = modelRules({ files: miniGenome(), revision: "c1", base });
    expect(r.outcome).toMatchObject({ execution: "completed", verdict: "pass" });
    expect(r.readiness?.actionable).toBe(true);
    expect(r.delta).toEqual({ added: [], removed: [], changed: [], affectedCriteria: [], affectedJourneys: [] });
  });

  it("fails a recipients list field with the topology.recipientArray derivation in observations", () => {
    const r = modelRules({ files: withRecipients(), revision: "c2", base });
    expect(r.outcome).toMatchObject({ execution: "completed", verdict: "fail" });
    const finding = r.outcome.observations.find((o) => (o as { rule?: string }).rule === "topology.recipientArray") as {
      level: string; subject: string; derivation: { rule?: string }; facts: unknown[]; pack: string;
    };
    expect(finding).toMatchObject({ level: "error", subject: "entity.ContactRecord", pack: "topology.private-pairs@1" });
    expect(finding.derivation.rule).toMatch(/^topology\.private-pairs@1:/);
    expect(JSON.stringify(finding.facts)).toContain("list<ref:entity.Account>");
    expect(r.outcome.observations).toContainEqual(expect.objectContaining({ kind: "introduced", errors: ["topology.recipientArray entity.ContactRecord"] }));
    expect(r.delta?.changed).toContainEqual({ id: "entity.ContactRecord", fields: ["fields"] });
  });

  it("judges every finding; a hook's packs/rulePrefix filter applies on the engine path", () => {
    expect(modelRules({ files: withRecipients(), revision: "c2" }).outcome.verdict).toBe("fail");
    const r = engineRun(withRecipients());
    expect(engineRules(r, { packs: ["metamodel"] }).verdict).toBe("pass");
    expect(engineRules(r, { rulePrefix: "topology." }).verdict).toBe("fail");
  });

  it("matches packs by id or id@version, and the ported artyfact packs by their v1 names", () => {
    const p = { id: "artyfact.readiness", version: "1" };
    expect(["artyfact.readiness", "artyfact.readiness@1", "readiness", "readiness@1"].map((w) => packMatches(w, p))).toEqual([true, true, true, true]);
    expect(["readiness@2", "artyfact", "ready"].map((w) => packMatches(w, p))).toEqual([false, false, false]);
    const packs = [{ id: "artyfact.topology.private-pairs", version: "1", source: 'violation("topology.recipientArray", X) :- a(X).\nmissing("topology.x", X) :- b(X).' }];
    expect(selectableRules(packs, { packs: ["topology.private-pairs@1"], rulePrefix: "topology.r" })).toEqual(["topology.recipientArray"]);
    expect(selectableRules(packs, { packs: ["metamodel@1"] })).toEqual([]);
  });

  it("fails (not errors) when the Genome does not parse, listing the issues", () => {
    const files = { ...miniGenome(), "node.yaml": "id: 42\n" };
    const r = modelRules({ files, revision: "c3" });
    expect(r.outcome).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(JSON.stringify(r.outcome.observations)).toContain("node.yaml");
  });

  it("fails when every pinned pack is unavailable, as readiness does", () => {
    const files = { ...miniGenome(), "node.yaml": miniGenome()["node.yaml"].replace(/  rulePacks:\n(    .*\n)*/, "  rulePacks:\n    - { id: nope, version: \"9\" }\n") };
    const r = modelRules({ files, revision: "c4" });
    expect(r.outcome).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(r.readiness?.actionable).toBe(false);
    expect(r.outcome.interpretation).toContain("rulePack.unavailable nope@9");
    // A hook that filters on the missing pack still sees its error.
    expect(engineRules(engineRun(files), { packs: ["nope@9"] }).verdict).toBe("fail");
  });

  it("runs the engine's own packs when no pack is pinned", () => {
    const files = { ...miniGenome(), "node.yaml": miniGenome()["node.yaml"].replace(/  rulePacks:\n(    .*\n)*/, "") };
    const r = modelRules({ files, revision: "c5" });
    expect(r.packs?.map((p) => p.id).filter((id) => id.startsWith("engine."))).toContain("engine.metamodel");
    expect(r.outcome.verdict).toBe("pass");
  });

  it("reports a v1 Genome under system/ as legacy (unknown), not as a parse error", () => {
    const files = { "system/system.yaml": "id: system.old\nname: Old\n", "system/kits.yaml": "kits: []\n", "src/index.ts": "export {}" };
    expect([...genomeRoot(files).keys()]).toEqual(["system.yaml", "kits.yaml"]);
    const r = modelRules({ files, revision: "c7" });
    expect(r.outcome).toMatchObject({ execution: "completed", verdict: "unknown", observations: [{ kind: "legacy-genome", reason: "legacy-genome" }] });
  });

  it("accepts a system/ prefixed file map", () => {
    const prefixed = Object.fromEntries(Object.entries(miniGenome()).map(([k, v]) => [`system/${k}`, v]));
    prefixed["src/index.ts"] = "export {}";
    expect([...genomeRoot(prefixed).keys()]).toContain("node.yaml");
    expect([...genomeRoot(prefixed).keys()]).not.toContain("src/index.ts");
    expect(modelRules({ files: prefixed, revision: "c6" }).outcome.verdict).toBe("pass");
  });
});
