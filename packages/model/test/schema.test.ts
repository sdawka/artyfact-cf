import { describe, expect, it } from "vitest";
import { parse as parseYaml, stringify } from "yaml";
import { schema } from "../src/index";
import { miniTemplateYaml, readTree } from "./helpers";

const roundTrip = <T>(s: { parse: (v: unknown) => T }, raw: unknown) => {
  const once = s.parse(raw);
  expect(s.parse(parseYaml(stringify(once)))).toEqual(once);
  return once;
};

describe("schema", () => {
  const files = readTree();
  const y = (p: string) => parseYaml(files.get(p)!);

  it("round-trips every fixture file through parse → stringify → parse", () => {
    roundTrip(schema.SystemFile, y("system.yaml"));
    roundTrip(schema.Purpose, y("purpose.yaml"));
    roundTrip(schema.ExternalsFile, y("externals.yaml"));
    roundTrip(schema.TheoryFile, y("theory.yaml"));
    roundTrip(schema.Description, y("description.yaml"));
    roundTrip(schema.KitsFile, y("kits.yaml"));
    roundTrip(schema.CriteriaFile, y("criteria.yaml"));
    roundTrip(schema.Thing, y("things/app/thing.yaml"));
    roundTrip(schema.OntologyFile, y("things/app/ontology.yaml"));
    roundTrip(schema.SpecFile, y("things/app/spec.yaml"));
    roundTrip(schema.CriteriaFile, y("things/app/criteria.yaml"));
    roundTrip(schema.Journey, y("journeys/J.notes.yaml"));
    roundTrip(schema.Evolution, y("evolutions/evolution.1.yaml"));
    roundTrip(schema.Template, parseYaml(miniTemplateYaml));
  });

  it("applies documented defaults", () => {
    const n = schema.OntologyNode.parse({ id: "screen.x", kind: "screen", name: "X" });
    expect(n).toMatchObject({ revision: 1, refines: [], links: [], states: [], fields: [], provisional: false });
    const l = schema.CrossLink.parse({ rel: "reads", to: "entity.X" });
    expect(l).toMatchObject({ direction: "out", certainty: "declared" });
    const c = schema.Criterion.parse({
      id: "C.x", title: "t", claim: "c", ownerKind: "system", ownerId: "system.x", subjectKind: "system",
      subjectId: "system.x", targetKind: "model", gates: [],
    });
    expect(c).toMatchObject({ version: 1, severity: "hard", deferred: false, hooks: [], sourceRefs: [] });
    expect(schema.SystemFile.parse({ id: "system.x", name: "x", template: null, things: [], purposes: [] }).phase).toBe("unrealized");
  });

  it("enforces id prefixes", () => {
    expect(schema.Id.thing.safeParse("thing.app").success).toBe(true);
    expect(schema.Id.thing.safeParse("things.app").success).toBe(false);
    expect(schema.Id.claim.safeParse("T1").success).toBe(true);
    expect(schema.Purpose.shape.id.safeParse("P1").success).toBe(true);
    expect(schema.Purpose.shape.id.safeParse("Purpose1").success).toBe(false);
    expect(schema.Id.templateRef.safeParse("template.thing.mini-webapp@1").success).toBe(true);
    expect(schema.Id.templateRef.safeParse("template.thing.mini-webapp").success).toBe(false);
  });

  it("round-trips a system-one assay hook", () => {
    const h = roundTrip(schema.AssayHook, {
      id: "hook.system.purpose", assay: "Purpose measures review", criteria: ["C.system.purpose"], tier: "semantic",
      engine: "system-one", targetKind: "model", triggers: ["submission"],
    });
    expect(h.engine).toBe("system-one");
  });

  it("rejects unknown enum values", () => {
    expect(schema.CrossLink.safeParse({ rel: "likes", to: "x" }).success).toBe(false);
  });

  it("accepts a realization whose agent role is author (the editor's manual commits)", () => {
    const r = schema.Realization.parse({
      id: "realization.1.r1", evolution: "evolution.1", agent: { id: "human:sam", role: "author" }, target: "app",
      workspace: { repo: "kit.app", fork: "kit.app--r1", baseCommit: "abc" }, status: "working",
    });
    expect(r.agent.role).toBe("author");
  });
});
