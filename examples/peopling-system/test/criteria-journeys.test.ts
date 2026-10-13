import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadGenome, validate } from "@artyfact/model";
import { metaTemplates } from "@artyfact/templates";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
function readTree(dir: string, out = new Map<string, string>()) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "test") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readTree(p, out);
    else if (/\.ya?ml$/.test(name)) out.set(relative(root, p), readFileSync(p, "utf8"));
  }
  return out;
}
const m = loadGenome(readTree(root), { templates: metaTemplates });

const byId = m.index.byId;
const known = (id: string) => id in byId;
const kindOf = (id: string) => byId[id]?.kind;
const sysCrit = m.criteria.filter((c) => c.ownerKind === "system");
const thingCrit = m.criteria.filter((c) => c.ownerKind === "thing" && !c.fromTemplate);
const hook = (id: string) => m.hooks.find((h) => h.id === id)!;
const journeys = m.journeys;

describe("per-Thing template criteria", () => {
  it("requires the Thing's own C.<thing>.checks, and flags its removal", () => {
    expect(validate(m).findings.filter((f) => f.rule === "template.criterionMissing")).toEqual([]);
    const files = readTree(root);
    const thing = "thing.webapp/node.yaml";
    const text = files.get(thing)!;
    const start = text.indexOf("  - id: C.thing.webapp.checks\n");
    files.set(thing, text.slice(0, start));
    const r = validate(loadGenome(files, { templates: metaTemplates }));
    expect(r.findings.filter((f) => f.rule === "template.criterionMissing").map((f) => f.subject)).toEqual(["thing.webapp"]);
    expect(r.actionable).toBe(false);
  });
});

describe("counts", () => {
  it("has the specified criteria, journeys and evolutions", () => {
    expect(sysCrit.map((c) => c.id)).toEqual(["structure", "purpose", "topology", "autonomy", "readiness", "promotion", "concurrency"].map((x) => `C.system.${x}`));
    expect(thingCrit).toHaveLength(13);
    expect(m.criteria.filter((c) => c.fromTemplate).map((c) => c.id).sort()).toEqual(["C.thing.webapp.checks", "C.webapp.exists", "C.webapp.health"]);
    expect(journeys).toHaveLength(10);
    expect(m.evolutions).toHaveLength(6);
  });
  it("J.connect has 14 steps; J.updates is deferred with 3 unresolved steps", () => {
    expect(journeys.find((j) => j.id === "J.connect")!.steps).toHaveLength(14);
    const u = journeys.find((j) => j.id === "J.updates")!;
    expect(u.deferred).toBe(true);
    expect(u.steps.filter((s) => s.unresolved)).toHaveLength(3);
  });
});

describe("system criteria", () => {
  it("are owned by the System over the model, gated at submission and promotion", () => {
    for (const c of sysCrit) {
      const gates = c.id === "C.system.concurrency" ? ["submission", "candidate", "promotion"] : ["submission", "promotion"];
      expect(c).toMatchObject({ ownerKind: "system", ownerId: "system.peopling", targetKind: "model", gates });
      expect(c.hooks.length).toBeGreaterThan(0);
    }
    expect(sysCrit.find((c) => c.id === "C.system.concurrency")).toMatchObject({ severity: "soft", sourceRefs: [] });
    expect(sysCrit.find((c) => c.id === "C.system.purpose")!.hooks).toEqual(["hook.system.purpose.model", "hook.system.purpose.outcome"]);
  });
  it("binds the platform-run hooks by engine, mode and trigger", () => {
    const expected: Record<string, [string, string | undefined, string[], string]> = {
      "hook.system.structure": ["model-rules", undefined, ["submission"], "bound"],
      "hook.system.readiness": ["model-rules", undefined, ["submission", "promotion"], "bound"],
      "hook.system.topology": ["model-rules", undefined, ["submission", "promotion"], "bound"],
      "hook.system.topology.semantic": ["system-one", undefined, ["submission"], "bound"],
      "hook.system.promotion": ["model-rules", undefined, ["submission", "promotion"], "bound"],
      "hook.system.overlap": ["diff", "overlap", ["submission", "candidate"], "bound"],
      "hook.system.autonomy": ["model-rules", undefined, ["submission", "promotion"], "defined"],
    };
    for (const [id, [engine, mode, triggers, binding]] of Object.entries(expected)) {
      expect(hook(id), id).toMatchObject({ engine, triggers, binding });
      expect(hook(id).inputs.mode, id).toBe(mode);
    }
    expect(sysCrit.find((c) => c.id === "C.system.promotion")!.hooks).toEqual(["hook.system.promotion"]);
    expect(sysCrit.find((c) => c.id === "C.system.topology")!.hooks).toEqual(["hook.system.topology", "hook.system.topology.semantic"]);
  });
  it("pins purpose model and outcome hooks", () => {
    expect(hook("hook.system.purpose.model")).toMatchObject({ engine: "system-one", tier: "semantic", triggers: ["submission"], binding: "bound" });
    expect(hook("hook.system.purpose.outcome")).toMatchObject({ engine: "llm", tier: "semantic", targetKind: "observation", triggers: ["outcome"], binding: "defined" });
  });
});

// Thing criterion → expected subject, links and hook engine (all execution tier, binding defined).
type Row = { engine: string; subject: string; refines?: string[]; satisfies?: string[]; deferred?: boolean };
const table: Record<string, Row> = {
  "private.owner": { engine: "vitest", subject: "policy.ownerOnly", satisfies: ["C.system.autonomy"] },
  "connection.consent": { engine: "vitest", subject: "operation.invite.accept" },
  "outgoing.single": { engine: "vitest", subject: "section.domain", satisfies: ["C.system.topology"] },
  "schedule.correct": { engine: "vitest", subject: "entity.RelationshipGoal" },
  "prompts.bounded": { engine: "vitest", subject: "screen.today", satisfies: ["C.system.autonomy"] },
  "screen.exact": { engine: "browser", subject: "section.ui" },
  "revocation.current": { engine: "vitest", subject: "policy.revocation" },
  "lifecycle.data": { engine: "vitest", subject: "operation.data.delete" },
  "screen.people": { engine: "browser", subject: "screen.people", refines: ["C.webapp.screen.exact"] },
  "contact.save": { engine: "browser", subject: "affordance.AddContactDialog.save", refines: ["C.webapp.screen.exact", "C.webapp.private.owner"] },
  "contact.storage": { engine: "vitest", subject: "entity.ContactRecord" },
  "digest.private": { engine: "vitest", subject: "section.domain", deferred: true },
  "photo.approved": { engine: "vitest", subject: "section.domain", deferred: true },
};

describe("webapp criteria", () => {
  it("pins subject, links, and exactly one hook (engine, tier, binding) per criterion", () => {
    expect(thingCrit.map((c) => c.id).sort()).toEqual(Object.keys(table).map((k) => `C.webapp.${k}`).sort());
    for (const [k, r] of Object.entries(table)) {
      const c = thingCrit.find((x) => x.id === `C.webapp.${k}`)!;
      expect(c, k).toMatchObject({ ownerKind: "thing", ownerId: "thing.webapp", subjectId: r.subject, severity: "hard", deferred: !!r.deferred, gates: ["candidate", "promotion"] });
      expect(c.refines, k).toEqual(r.refines ?? []);
      expect(c.satisfies, k).toEqual(r.satisfies ?? []);
      expect(c.hooks, k).toEqual([`hook.webapp.${k}`]);
      expect(hook(`hook.webapp.${k}`), k).toMatchObject({ criteria: [c.id], engine: r.engine, tier: "execution", binding: "defined" });
      if (r.deferred) expect(c.applicableWhen).toBe("module enabled");
    }
  });
  it("the template criteria keep their hooks", () => {
    expect(hook("hook.webapp.exists")).toMatchObject({ engine: "manifest", binding: "bound" });
    expect(hook("hook.webapp.health")).toMatchObject({ engine: "http", binding: "defined" });
  });
});

describe("references resolve in the loaded model", () => {
  it("criteria", () => {
    for (const c of m.criteria) {
      expect(known(c.subjectId), `${c.id} subject ${c.subjectId}`).toBe(true);
      expect(kindOf(c.subjectId), `${c.id} subject kind`).toBe(c.subjectKind);
      expect(known(c.ownerId), `${c.id} owner`).toBe(true);
      for (const r of [...c.sourceRefs, ...c.refines, ...c.satisfies]) expect(known(r), `${c.id} -> ${r}`).toBe(true);
      for (const h of c.hooks) expect(m.hooks.some((x) => x.id === h), `${c.id} hook ${h}`).toBe(true);
    }
    for (const h of m.hooks) for (const cid of h.criteria) expect(m.criteria.find((c) => c.id === cid)?.hooks, h.id).toContain(h.id);
  });
  it("journeys: steps, edges, labels and reachability", () => {
    for (const j of journeys) {
      const ids = new Set(j.steps.map((s) => s.id));
      expect(ids.size, `${j.id} unique step ids`).toBe(j.steps.length);
      expect(ids.has(j.start), `${j.id} start`).toBe(true);
      expect(j.steps.some((s) => s.kind === "end"), `${j.id} has an end`).toBe(true);
      for (const f of j.features) expect(known(f), f).toBe(true);
      for (const r of j.requirements) expect(known(r), r).toBe(true);
      for (const s of j.steps) {
        const at = `${j.id}.${s.id}`;
        for (const n of s.next) expect(ids.has(n.to), `${at} -> ${n.to}`).toBe(true);
        if (s.next.length > 1) for (const n of s.next) expect(n.when, `${at} -> ${n.to} needs a when label`).toBeTruthy();
        if (s.kind === "branch") expect(s.next.length, `${at} branch edges`).toBeGreaterThanOrEqual(2);
        if (s.kind === "end") expect(s.next, `${at} end`).toEqual([]);
        if (s.screen) expect(kindOf(s.screen), `${at} screen`).toBe("screen");
        if (s.operation) expect(kindOf(s.operation), `${at} operation`).toBe("operation");
        if (s.external) expect(kindOf(s.external), `${at} external`).toBe("external");
        for (const r of s.requirementRefs) expect(kindOf(r), `${at} ${r}`).toBe("requirement");
      }
      if (!j.deferred) {
        const seen = new Set<string>();
        const go = (id: string) => { if (!seen.has(id)) { seen.add(id); j.steps.find((s) => s.id === id)!.next.forEach((n) => go(n.to)); } };
        go(j.start);
        expect([...seen].sort(), `${j.id} reachable`).toEqual([...ids].sort());
      }
    }
  });
  it("evolutions: order, links, nodes and criteria", () => {
    const ev = m.evolutions;
    expect(ev.map((e) => e.state)).toEqual(["actionable", "actionable", "proposed", "proposed", "proposed", "proposed"]);
    expect(ev.map((e) => e.kind)).toEqual(["implementation", "implementation", "implementation", "implementation", "genome-amendment", "genome-amendment"]);
    expect(ev.map((e) => e.dependsOn)).toEqual([[], [], ["evolution.2"], ["evolution.3"], [], []]);
    expect(ev[0]!.acceptanceCriteria).toEqual(["exists", "health", "private.owner", "screen.exact", "contact.save", "screen.people", "contact.storage"].map((x) => `C.webapp.${x}`));
    for (const e of ev) {
      for (const n of e.affectedNodes) expect(known(n), `${e.id} node ${n}`).toBe(true);
      for (const c of e.acceptanceCriteria) expect(kindOf(c) ?? m.criteria.find((x) => x.id === c)?.id, `${e.id} ${c}`).toBeTruthy();
      for (const d of e.dependsOn) expect(ev.some((x) => x.id === d)).toBe(true);
    }
  });
});

describe("validate", () => {
  const r = validate(m);
  it("has no errors", () => {
    expect(r.findings.filter((f) => f.level === "error").map((f) => [f.rule, f.subject])).toEqual([]);
  });
  it("has exactly the expected warnings and gaps", () => {
    const rest = r.findings.filter((f) => (f.level === "error" || f.level === "warning") && f.rule !== "hook.unbound");
    // hook.unbound: every hook with binding "defined" is a planned assay with no implementation yet.
    const unbound = r.findings.filter((f) => f.rule === "hook.unbound").map((f) => f.subject).sort();
    expect(unbound).toEqual(m.criteria.filter((c) => !c.deferred).filter((c) => c.hooks.some((h) => hook(h).binding === "defined")).map((c) => c.id).sort());
    // kit.unpinned auth: the authentication Kit is required but intentionally unpinned until a provider is chosen (spec section 9).
    expect(rest.map((f) => [f.level, f.rule, f.subject])).toEqual([["warning", "kit.unpinned", "auth"]]);
    // The engine's completeness pack marks the provisional nodes as open gaps.
    const provisional = m.nodes.filter((n) => n.provisional).map((n) => n.id).sort();
    expect(r.findings.filter((f) => f.level === "missing").map((f) => [f.rule, f.subject]).sort()).toEqual(provisional.map((id) => ["node.provisional", id]));
  });
});
