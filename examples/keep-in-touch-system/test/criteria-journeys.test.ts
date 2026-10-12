import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { loadSystem, schema } from "@artyfact/model";
import { templates } from "@artyfact/templates";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const yaml = (p: string) => parseYaml(read(p));
const dir = (d: string) => readdirSync(join(root, d)).filter((f) => /\.ya?ml$/.test(f)).sort();

// Ids owned by slice 1.1a (docs/design/model.md A.4), used when its files are not on this branch.
const hardcoded = new Set<string>([
  "system.keep-in-touch", "thing.webapp", "P1", "T1", "T2", "T3", "T4", "T5",
  ...["owner", "contacts", "relationship-context", "channels", "device", "providers", "events"].map((x) => `ext.${x}`),
  ...["contacts", "goals", "connect", "prompts", "updates"].map((x) => `GD.${x}`),
  ...["scope", "qualification", "due", "prompts", "screens", "authentication", "operations", "concurrency"].map((x) => `S.webapp.${x}`),
  ...["signin", "today", "people", "person", "goal", "logContact", "invitation", "settings"].map((x) => `screen.${x}`),
  ...["Account", "ContactRecord", "ConnectionInvite", "Connection", "Block", "RelationshipGoal", "ContactEvent", "Suggestion", "NotificationJob",
    "MessageDraft", "DigestEdition", "Subscription", "MediaAsset"].map((x) => `entity.${x}`),
  ...["contact.save", "goal.save", "contact.log", "invite.create", "invite.accept", "connection.revoke", "data.export", "data.delete"].map((x) => `operation.${x}`),
  ...["ownerOnly", "pairConsent", "revocation", "authentication"].map((x) => `policy.${x}`),
  ...["worker", "contactsStore", "scheduler"].map((x) => `binding.${x}`),
  ...["ui", "domain", "authorization", "runtime"].map((x) => `section.${x}`),
  "affordance.AddContactDialog.save",
]);

const hasGenomeA = existsSync(join(root, "things/webapp/ontology.yaml"));
const loaded = hasGenomeA
  ? loadSystem(new Map(walk(root).map((p) => [p, read(p)] as const)), { templates })
  : undefined;

function walk(base: string, rel = ""): string[] {
  return readdirSync(join(base, rel), { withFileTypes: true }).flatMap((e) => {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name === "node_modules" || e.name === "test" ? [] : walk(base, p);
    return /\.ya?ml$/.test(e.name) ? [p] : [];
  });
}

const sys = schema.CriteriaFile.parse(yaml("criteria.yaml"));
const thing = schema.CriteriaFile.parse(yaml("things/webapp/criteria.yaml"));
const journeys = dir("journeys").map((f) => schema.Journey.parse(yaml(`journeys/${f}`)));
const evolutions = dir("evolutions").map((f) => schema.Evolution.parse(yaml(`evolutions/${f}`)));
const criterionIds = new Set([...sys.criteria, ...thing.criteria].map((c) => c.id).concat(["C.webapp.exists", "C.webapp.health"]));
const hookIds = new Set([...sys.hooks, ...thing.hooks].map((h) => h.id));
const known = (id: string) => (loaded ? loaded.index.byId.has(id) : hardcoded.has(id)) || criterionIds.has(id);

describe("counts", () => {
  it("has the specified numbers of criteria, journeys, evolutions", () => {
    expect(sys.criteria.map((c) => c.id)).toEqual(
      ["structure", "purpose", "topology", "autonomy", "readiness", "promotion"].map((x) => `C.system.${x}`));
    expect(thing.criteria.length).toBeGreaterThanOrEqual(13);
    expect(dir("journeys")).toHaveLength(10);
    expect(evolutions).toHaveLength(6);
  });
  it("J.connect has 14 steps and J.updates is deferred with 3 unresolved steps", () => {
    expect(journeys.find((j) => j.id === "J.connect")!.steps).toHaveLength(14);
    const u = journeys.find((j) => j.id === "J.updates")!;
    expect(u.deferred).toBe(true);
    expect(u.steps.filter((s) => s.unresolved)).toHaveLength(3);
  });
});

describe("criteria", () => {
  const all = [...sys.criteria, ...thing.criteria];
  it("resolve subjects, owners, sources, links and hooks", () => {
    for (const c of all) {
      expect(known(c.subjectId), `${c.id} subject ${c.subjectId}`).toBe(true);
      expect(known(c.ownerId), `${c.id} owner`).toBe(true);
      for (const r of [...c.sourceRefs, ...c.refines, ...c.satisfies]) expect(known(r), `${c.id} -> ${r}`).toBe(true);
      for (const h of c.hooks) expect(hookIds.has(h), `${c.id} hook ${h}`).toBe(true);
    }
  });
  it("every hook points back at criteria that list it", () => {
    for (const h of [...sys.hooks, ...thing.hooks]) {
      for (const cid of h.criteria) expect(all.find((c) => c.id === cid)?.hooks, `${h.id}`).toContain(h.id);
    }
  });
  it("C.system.purpose has the model and outcome bindings", () => {
    const hooks = Object.fromEntries(sys.hooks.map((h) => [h.id, h]));
    expect(hooks["hook.system.purpose.model"]).toMatchObject({ engine: "model-rules", tier: "semantic", triggers: ["submission"] });
    expect(hooks["hook.system.purpose.outcome"]).toMatchObject({ engine: "llm", tier: "semantic", targetKind: "observation", triggers: ["outcome"], binding: "defined" });
  });
  it("only the later criteria are deferred; none redeclare the template's", () => {
    expect(thing.criteria.filter((c) => c.deferred).map((c) => c.id).sort()).toEqual(["C.webapp.digest.private", "C.webapp.photo.approved"]);
    expect(criterionIds.size).toBe(sys.criteria.length + thing.criteria.length + 2);
  });
});

describe("journeys", () => {
  it("every step reference and next target resolves", () => {
    for (const j of journeys) {
      const ids = new Set(j.steps.map((s) => s.id));
      expect(ids.size, `${j.id} unique step ids`).toBe(j.steps.length);
      expect(ids.has(j.start), `${j.id} start`).toBe(true);
      expect(j.steps.some((s) => s.kind === "end"), `${j.id} has an end`).toBe(true);
      for (const f of j.features) expect(known(f), f).toBe(true);
      for (const r of j.requirements) expect(known(r), r).toBe(true);
      for (const s of j.steps) {
        for (const n of s.next) expect(ids.has(n.to), `${j.id}.${s.id} -> ${n.to}`).toBe(true);
        for (const ref of [s.screen, s.operation, s.external, ...s.requirementRefs]) if (ref) expect(known(ref), `${j.id}.${s.id} ${ref}`).toBe(true);
      }
    }
  });
  it("every step is reachable from start", () => {
    for (const j of journeys.filter((x) => !x.deferred)) {
      const seen = new Set<string>();
      const go = (id: string) => { if (seen.has(id)) return; seen.add(id); j.steps.find((s) => s.id === id)!.next.forEach((n) => go(n.to)); };
      go(j.start);
      expect([...seen].sort(), j.id).toEqual(j.steps.map((s) => s.id).sort());
    }
  });
});

describe("evolutions", () => {
  it("map nodes and criteria, in the specified order", () => {
    expect(evolutions.map((e) => e.state)).toEqual(["actionable", "proposed", "proposed", "proposed", "proposed", "proposed"]);
    expect(evolutions.map((e) => e.kind)).toEqual(["implementation", "implementation", "implementation", "implementation", "genome-amendment", "genome-amendment"]);
    expect(evolutions.map((e) => e.dependsOn)).toEqual([[], ["evolution.1"], ["evolution.2"], ["evolution.3"], [], []]);
    expect(evolutions[0]!.acceptanceCriteria).toEqual(
      ["exists", "health", "private.owner", "screen.exact", "contact.save", "screen.people", "contact.storage"].map((x) => `C.webapp.${x}`));
    for (const e of evolutions) {
      for (const n of e.affectedNodes) expect(known(n), `${e.id} node ${n}`).toBe(true);
      for (const c of e.acceptanceCriteria) expect(criterionIds.has(c), `${e.id} criterion ${c}`).toBe(true);
      for (const d of e.dependsOn) expect(evolutions.some((x) => x.id === d)).toBe(true);
    }
  });
});

describe.skipIf(!loaded)("against the loaded Genome", () => {
  it("the hard-coded id list is consistent with the ontology", () => {
    for (const id of hardcoded) expect(loaded!.index.byId.has(id), id).toBe(true);
  });
  it("criteria, journeys and evolutions load into the model", () => {
    expect(loaded!.journeys).toHaveLength(10);
    expect(loaded!.evolutions).toHaveLength(6);
    expect(loaded!.criteria.length).toBeGreaterThanOrEqual(6 + 13 + 2);
  });
});
