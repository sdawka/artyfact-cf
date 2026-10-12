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

  it("fails (not errors) when the Genome does not parse, listing the issues", () => {
    const files = { ...miniGenome(), "system.yaml": "id: 42\n" };
    const r = modelRules({ files, revision: "c3" });
    expect(r.outcome).toMatchObject({ execution: "completed", verdict: "fail" });
    expect(JSON.stringify(r.outcome.observations)).toContain("system.yaml");
  });

  it("records an error when a pinned pack does not exist", () => {
    const files = { ...miniGenome(), "kits.yaml": "kits: []\nrulePacks:\n  - { id: nope, version: \"9\" }\nrequired: []\n" };
    const r = modelRules({ files, revision: "c4" });
    expect(r.outcome).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(JSON.stringify(r.outcome.observations)).toContain("unknown rule pack nope@9");
  });

  it("is unknown when no packs are pinned (nothing checked is not a pass)", () => {
    const files = { ...miniGenome(), "kits.yaml": "kits: []\nrulePacks: []\nrequired: []\n" };
    expect(modelRules({ files, revision: "c5" }).outcome.verdict).toBe("unknown");
  });

  it("accepts a system/ prefixed file map", () => {
    const prefixed = Object.fromEntries(Object.entries(miniGenome()).map(([k, v]) => [`system/${k}`, v]));
    prefixed["src/index.ts"] = "export {}";
    expect([...genomeRoot(prefixed).keys()]).toContain("system.yaml");
    expect([...genomeRoot(prefixed).keys()]).not.toContain("src/index.ts");
    expect(modelRules({ files: prefixed, revision: "c6" }).outcome.verdict).toBe("pass");
  });
});
