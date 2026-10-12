import { describe, expect, it } from "vitest";
import { loadSystem, RELATIONS, toFacts } from "../src/index";
import { edit, factsDoc, readTree, realPacks, store } from "./helpers";

const decls = (src: string) =>
  new Map([...src.matchAll(/^\.decl\s+(\w+)\(([^)]*)\)/gm)].map((m) => [m[1], m[2].split(",").length] as const));
const OUTPUTS = ["violation", "missing", "warning", "semanticCandidate"];

// The fixture plus edits that switch on the opt-in relations, so every relation has at least one tuple.
function fullFacts() {
  let f = readTree();
  f = edit(f, "things/app/ontology.yaml", "{ id: entity.Owner, kind: entity, name: Owner, parent: section.domain }", "{ id: entity.Owner, kind: entity, name: Owner, parent: section.domain, provisional: true }");
  f = edit(f, "journeys/J.notes.yaml", "kind: end }", "kind: end, unresolved: true }");
  f = edit(f, "journeys/J.notes.yaml", "actorGoal:", "deferred: true\nactorGoal:");
  f = edit(f, "theory.yaml", "limitation: Lab conditions only", "limitation: Lab conditions only\n    deferred: true");
  f = edit(f, "criteria.yaml", "    hooks: [hook.system.structure]", "    hooks: [hook.system.structure]\n    deferred: true");
  return toFacts(loadSystem(f, { templates: store() }));
}

describe("fact schema conformance", () => {
  const facts = fullFacts();
  const emitted = new Map([...facts.relations].map(([k, ts]) => [k, new Set(ts.map((t) => t.length))] as const));

  it("emits every relation in RELATIONS, each with a single arity", () => {
    expect([...emitted.keys()].sort()).toEqual([...RELATIONS].sort());
    for (const [rel, arities] of emitted) expect(arities.size, rel).toBe(1);
  });

  it("matches the EDB set and arities of docs/design/facts.md (+ amendments hasActor/hasEffects)", () => {
    const doc = decls(factsDoc);
    const idb = new Set(["ancestor", "governedBy", "governedDirect", "mutating", "reaches", "privateEntity", "claimLinked", "connection", "outgoingDirect"]);
    const edb = new Map([...doc].filter(([k]) => !idb.has(k) && !OUTPUTS.includes(k)));
    edb.set("hasActor", 1).set("hasEffects", 1);
    expect([...emitted.keys()].sort()).toEqual([...edb.keys()].sort());
    for (const [rel, arity] of edb) expect([...emitted.get(rel)!], rel).toEqual([arity]);
  });

  it("supplies every non-derived relation the real packs declare, with the declared arity", () => {
    const heads = new Set(realPacks.flatMap((p) => [...p.source.matchAll(/^(\w+)\([^%]*?(?::-|\)\s*\.\s*$)/gm)].map((m) => m[1])));
    const needed = new Map<string, number>();
    // outgoingDirect: declared by topology.private-pairs@1, derived by no pack and marked "?" (IDB) in facts.md, so
    // nothing supplies it yet; its rule cannot fire. Flagged in the w0-model report, not emitted by toFacts().
    const unsupplied = new Set(["outgoingDirect"]);
    for (const p of realPacks) for (const [rel, arity] of decls(p.source)) if (!heads.has(rel) && !OUTPUTS.includes(rel) && !unsupplied.has(rel)) needed.set(rel, arity);
    expect(needed.size).toBeGreaterThan(20);
    for (const [rel, arity] of needed) {
      expect(emitted.has(rel), `${rel} is declared by a pack but not emitted`).toBe(true);
      expect([...emitted.get(rel)!], rel).toEqual([arity]);
    }
  });
});
