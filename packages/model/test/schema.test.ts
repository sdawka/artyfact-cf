import { describe, expect, it } from "vitest";
import { parse as parseYaml, stringify } from "yaml";
import { schema } from "../src/index";
import { load } from "./helpers";

const roundTrip = <T>(s: { parse: (v: unknown) => T }, raw: unknown) => {
  const once = s.parse(raw);
  expect(s.parse(parseYaml(stringify(once)))).toEqual(once);
  return once;
};

describe("schema", () => {
  const m = load();

  it("round-trips every projected object through parse → stringify → parse", () => {
    const { things, purposes, ...system } = m.system;
    roundTrip(schema.SystemFile, { ...system, things, purposes });
    for (const p of m.purposes) roundTrip(schema.Purpose, p);
    for (const e of m.externals) roundTrip(schema.Externals, e);
    for (const c of m.claims) roundTrip(schema.TheoryClaim, c);
    roundTrip(schema.Description, m.description!);
    roundTrip(schema.KitsFile, m.kits);
    for (const c of m.criteria) roundTrip(schema.Criterion, c);
    for (const h of m.hooks) roundTrip(schema.AssayHook, h);
    for (const t of m.things) roundTrip(schema.Thing, t);
    for (const n of m.nodes) roundTrip(schema.OntologyNode, n);
    for (const r of m.requirements) roundTrip(schema.Requirement, r);
    for (const j of m.journeys) roundTrip(schema.Journey, j);
    for (const e of m.evolutions) roundTrip(schema.Evolution, e);
    for (const t of m.templates) roundTrip(schema.Template, t);
  });

  it("records command-created output without fabricating a package source path", () => {
    const raw = { kind: "file", path: "src/generated.ts", contribution: "ui", disposition: "adapted",
      command: { id: "adapt", contribution: "ui", action: "created" } };
    expect(roundTrip(schema.PartOutputMapping, raw)).toEqual(raw);
    expect(schema.PartOutputMapping.safeParse({ ...raw, command: undefined }).success).toBe(false);
    expect(schema.PartOutputMapping.safeParse({ ...raw, command: { ...raw.command, id: "bad id" } }).success).toBe(false);
    expect(schema.PartOutputMapping.safeParse({ ...raw, sourcePath: "src/old.ts", command: { ...raw.command, action: "changed" } }).success).toBe(true);
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

  it("loads Genome-only Things while preserving legacy template ids", () => {
    expect(schema.Thing.parse({ id: "thing.idea", name: "Idea", description: "Genome only" })).toEqual({
      id: "thing.idea", name: "Idea", description: "Genome only", templateRef: null, artifacts: [], parts: [], purposeRefs: [],
    });
    expect(m.things[0]!.templateRef).toBe("template.thing.mini-webapp@1");
  });

  it("rejects unknown enum values", () => {
    expect(schema.CrossLink.safeParse({ rel: "reads", to: "x", certainty: "rumoured" }).success).toBe(false);
    expect(schema.Criterion.shape.targetKind.safeParse("vibes").success).toBe(false);
  });

  it("accepts a realization whose agent role is author (the editor's manual commits)", () => {
    const r = schema.Realization.parse({
      id: "realization.1.r1", evolution: "evolution.1", agent: { id: "human:sam", role: "author" }, target: "app",
      workspace: { repo: "kit.app", fork: "kit.app--r1", baseCommit: "abc" }, status: "working",
    });
    expect(r.agent.role).toBe("author");
  });
});
