import { describe, expect, it } from "vitest";
import { genomeRoot, loadGenome, modelRules } from "../../worker/hooks/model-rules";
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

  it("filters findings by hook inputs (packs / rulePrefix)", () => {
    const onlyMeta = modelRules({ files: withRecipients(), revision: "c2", filter: { packs: ["metamodel"] } });
    expect(onlyMeta.outcome.verdict).toBe("pass");
    const topo = modelRules({ files: withRecipients(), revision: "c2", filter: { rulePrefix: "topology." } });
    expect(topo.outcome.verdict).toBe("fail");
  });

  it("a filter selecting only info-level rules is unknown", () => {
    const r = modelRules({ files: withRecipients(), revision: "c2", filter: { packs: ["topology.private-pairs"], rulePrefix: "semantic:" } });
    expect(r.outcome.verdict).toBe("unknown");
    expect(r.outcome.observations).toContainEqual(expect.objectContaining({ kind: "filter-selects-only-info-rules", filter: { packs: ["topology.private-pairs"], rulePrefix: "semantic:" } }));
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
    expect(modelRules({ files, revision: "c4", filter: { packs: ["nope@9"] } }).outcome.verdict).toBe("fail");
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
