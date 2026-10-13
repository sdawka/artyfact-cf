import { describe, expect, it } from "vitest";
import {
  ARTYFACT_GENOME, ARTYFACT_KINDS, artyfactTemplateStore, checkTemplateForm, checkViewHints, evaluate, evaluateAndJudge, fakeSystemOne, instantiateNodes,
  loadArtyfactSystem, resolveKindView, type Graph, type Readiness,
} from "@artyfact/ontology";
import { edit, referenceFindings, referenceModel, systemFiles, type Files } from "../../ontology/test/artyfact-reference";
import * as packs from "../../ontology/test/vendor/artyfact/packs";
import { composeTemplate, loadMetaTemplate, metaTemplates, templateRefs, templates } from "../src/index";
import { files as bundled } from "../src/generated/files";

const systemRef = "template.system.social-networking.cloudflare@1";
const workerRef = "template.thing.cloudflare-worker-webapp@1";
const vueRef = "template.thing.vue-webapp@1";
const refs = [systemRef, workerRef, vueRef];

/** The bundled template directory as the engine's artyfact adapter reads it (it prefers `template.v1.yaml`). */
const bundledDir: Files = Object.fromEntries(Object.entries(bundled).filter(([p]) => !p.startsWith("rule-packs/")));
/** The same directory in artyfact's own layout, for its reference loader: the legacy shape as `template.yaml`. */
const legacy: Files = Object.fromEntries(
  Object.entries(bundledDir).filter(([p]) => !p.endsWith("/template.yaml")).map(([p, t]) => [p.replace("/template.v1.yaml", "/template.yaml"), t]),
);

const sys = systemFiles();
const ONTOLOGY = "things/webapp/ontology.yaml";
const pairs = (fs: { rule: string; subject?: string }[]) => [...new Set(fs.map((f) => `${f.rule} ${f.subject ?? ""}`))].sort();
const ours = (r: Readiness) => pairs(r.findings.filter((f) => f.pack?.startsWith("artyfact.")));
const allPacks = [packs.metamodel, packs.readiness, packs.authorization, packs.journeys, packs.theory, packs.topologyPrivatePairs];
/** Reference rules the base packs drop on purpose: a Genome-only Thing binds no artifact. */
const DROPPED = new Set(["thing.noArtifact"]);
const theirs = (files: Files) => pairs(referenceFindings(referenceModel(files, legacy), allPacks).filter((f) => !DROPPED.has(f.rule)));
const template = composeTemplate(systemRef, [workerRef]);
const load = (files: Files) => loadArtyfactSystem(files, { templates: artyfactTemplateStore(bundledDir) }) as Graph;

describe("meta@1 templates", () => {
  it("bundles the three templates as meta@1 beside their legacy shape", () => {
    expect(templateRefs().sort()).toEqual([workerRef, systemRef, vueRef].sort());
    for (const ref of refs) expect(metaTemplates.get(ref)).toMatchObject({ meta: 1, extends: ARTYFACT_GENOME });
  });

  it.each(refs)("%s is form valid and extends the artyfact base", (ref) => {
    const t = loadMetaTemplate(ref);
    expect(t.lineage).toEqual([ref, ARTYFACT_GENOME]);
    expect(checkTemplateForm(t, metaTemplates)).toMatchObject({ valid: true, findings: [] });
    expect(checkViewHints(t)).toEqual([]);
  });

  it.each(refs)("%s resolves a view for every kind", (ref) => {
    const t = loadMetaTemplate(ref);
    expect(t.view?.layers?.length).toBeGreaterThan(0);
    for (const kind of ARTYFACT_KINDS) {
      expect(t.kinds[kind]?.view, kind).toMatchObject({ label: expect.any(String), glyph: expect.any(String), colour: expect.any(String) });
      const v = resolveKindView(t, kind);
      expect(v.glyph.length).toBeLessThanOrEqual(2);
      expect(v.plural.length).toBeGreaterThan(0);
    }
    const layers = new Set(t.view!.layers!.map((l) => l.id));
    const drawn = ARTYFACT_KINDS.filter((k) => t.kinds[k]?.view?.layer !== undefined);
    expect(drawn).toEqual(expect.arrayContaining(["screen", "operation", "journey", "purpose", "binding", "policy"]));
    expect(drawn.every((k) => layers.has(t.kinds[k]!.view!.layer!))).toBe(true);
  });

  it("legal parents follow the Genome tree rules", () => {
    const t = loadMetaTemplate(systemRef);
    for (const k of ["purpose", "claim", "external", "feature", "commitment"]) expect(t.kinds[k]!.parents).toEqual(["system"]);
    expect(t.kinds.journey!.parents).toEqual(["system", "thing"]);
    expect(t.kinds.requirement!.parents).toEqual(expect.arrayContaining(["screen", "operation", "entity", "thing", "system", "claim"]));
  });

  it("the domain rule packs live in the templates, the generic ones in the base", () => {
    const ids = (ref: string) => loadMetaTemplate(ref).rules.map((r) => r.id);
    expect(ids(systemRef)).toEqual(["artyfact.facts", "artyfact.metamodel", "artyfact.readiness", "artyfact.theory", "artyfact.topology.private-pairs"]);
    for (const ref of [workerRef, vueRef]) expect(ids(ref)).toEqual(["artyfact.facts", "artyfact.metamodel", "artyfact.authorization", "artyfact.journeys"]);
    expect(composeTemplate(systemRef, [workerRef, vueRef]).rules.map((r) => r.id).sort()).toEqual([
      "artyfact.authorization", "artyfact.facts", "artyfact.journeys", "artyfact.metamodel", "artyfact.readiness", "artyfact.theory", "artyfact.topology.private-pairs",
    ]);
    expect(loadMetaTemplate(systemRef).questions.map((q) => q.id)).toEqual(["topology.multiRecipient"]);
  });

  it.each([workerRef, vueRef, systemRef])("%s prefilled nodes, criteria and hooks match its legacy shape", (ref) => {
    const t = loadMetaTemplate(ref);
    const v1 = templates.get(ref)!;
    const inst = instantiateNodes(t, "thing.x");
    const ontology = inst.filter((n) => !["template", "criterion", "hook"].includes(n.kind));
    expect(ontology.map((n) => n.id)).toEqual(v1.nodes.map((n) => n.id));
    for (const n of v1.nodes) {
      const m = ontology.find((x) => x.id === n.id)!;
      expect([m.kind, m.parent, m.fields.name, m.fields.description, !!m.provisional])
        .toEqual([n.kind, n.parent === "$thing" || n.parent === "$system" ? "thing.x" : n.parent, n.name, n.description, !!n.provisional]);
    }
    expect(inst.filter((n) => n.kind === "criterion").map((n) => n.id)).toEqual(v1.criteria.map((c) => c.id));
    expect(t.criteria.map((c) => [c.id, c.hooks, c.gates])).toEqual(v1.criteria.map((c) => [c.id, c.hooks, c.gates]));
    expect(inst.filter((n) => n.kind === "hook").map((n) => n.id)).toEqual(v1.hooks.map((h) => h.id));
  });

  it("the worker's source globs sit on its root and prefilled nodes, relative to the Thing root", () => {
    const t = loadMetaTemplate(workerRef);
    const fromNodes = Object.fromEntries(t.nodes.filter((n) => n.files).map((n) => [n.id, n.files]));
    expect(fromNodes).toEqual({ "binding.d1": ["migrations/**"], "section.ui": ["src/ui/**"], "section.domain": ["src/worker/routes/**"] });
    expect(t.files).toEqual([
      "src/worker/health.ts",
      "{package.json,package-lock.json,tsconfig.json,vitest.config.ts,wrangler.jsonc,wrangler.test.jsonc,.gitignore,.dev.vars.example,README.md}",
      "src/index.ts", "src/worker/env.ts", "src/worker/phenome.ts", "test/**", "public/*", ".artyfact/**",
    ]);
    expect(loadMetaTemplate(vueRef).files).toBeUndefined();
  });
});

const mutations: [name: string, rules: string[], mutate: (f: Files) => Files][] = [
  ["dangling requirement subject", ["ref.dangling"], (f) => edit(f, "things/webapp/spec.yaml", (d) => { d.requirements[0].subjects.push("screen.ghost"); })],
  ["orphan node", ["ref.parentMissing", "owner.unknown", "ref.dangling"], (f) => edit(f, "things/webapp/ontology.yaml", (d) => {
    d.nodes.push({ id: "screen.orphan", kind: "screen", name: "Orphan", parent: "section.ghost", owningThing: "thing.ghost" });
  })],
  ["containment cycle", ["tree.cycle"], (f) => edit(f, "things/webapp/ontology.yaml", (d) => {
    d.nodes.push({ id: "component.a", kind: "component", name: "A", parent: "component.b" }, { id: "component.b", kind: "component", name: "B", parent: "component.a" });
  })],
  ["criterion with missing owner and subject", ["criterion.subjectMissing", "criterion.ownerMissing", "coverage.hook"], (f) => edit(f, "things/webapp/criteria.yaml", (d) => {
    d.criteria.push({ id: "C.webapp.ghost", title: "Ghost", claim: "x", ownerKind: "thing", ownerId: "thing.ghost", subjectKind: "screen", subjectId: "screen.ghost", targetKind: "artifact", gates: ["candidate"] });
  })],
  ["system criterion owned by a thing", ["criterion.ownerMissing"], (f) => edit(f, "criteria.yaml", (d) => { d.criteria[0].ownerId = "thing.webapp"; })],
  ["Genome-only thing without artifacts", [], (f) => edit(f, "things/webapp/thing.yaml", (d) => { d.artifacts = []; })],
  ["thing sections diverge from its template", ["thing.sectionMissing", "template.sectionMissing"], (f) => edit(f, "things/webapp/thing.yaml", (d) => { d.sections = ["section.ui", "section.ghost"]; })],
  ["uncovered requirement", ["coverage.requirement"], (f) => edit(f, "things/webapp/spec.yaml", (d) => { d.requirements.push({ id: "S.webapp.extra", thing: "thing.webapp", title: "Extra", text: "x" }); })],
  ["template criterion moved to the system", ["template.criterionMissing"], (f) => edit(f, "things/webapp/criteria.yaml", (d) => {
    d.criteria.push({ id: "C.webapp.exists", title: "Exists", claim: "x", ownerKind: "system", ownerId: "system.keep-in-touch", subjectKind: "thing", subjectId: "thing.webapp", targetKind: "artifact", gates: ["candidate"], hooks: ["hook.webapp.exists"] });
  })],
  ["empty evolution", ["evolution.acceptanceMissing", "evolution.affectsMissing"], (f) => edit(f, "evolutions/evolution.7.yaml", () =>
    ({ id: "evolution.7", title: "Empty", intent: "x", state: "proposed", kind: "implementation", affectedNodes: [], acceptanceCriteria: [] }))],
  ["inbound link from an unknown node", [], (f) => edit(f, "things/webapp/ontology.yaml", (d) => { d.nodes[0].links.push({ rel: "governs", to: "policy.ghost", direction: "in" }); })],
  ["unresolved step pointing ahead", [], (f) => edit(f, "journeys/J.contact.yaml", (d) => { Object.assign(d.steps[0], { unresolved: true, screen: "screen.future" }); })],
  ["auth kit pinned", [], (f) => edit(f, "kits.yaml", (d) => { d.kits.push({ id: "auth", version: "1" }); })],
  ["deferred criteria and bound hooks", ["kit.unpinned"], (f) => edit(edit(f, "things/webapp/criteria.yaml", (d) => {
    for (const c of d.criteria) c.deferred = true;
    for (const h of d.hooks) h.binding = "bound";
  }), "criteria.yaml", (d) => { for (const h of d.hooks ?? []) h.binding = "bound"; })],
  ["write without a policy, reading owner-only data", ["authz.ungoverned", "authz.privateReadUngoverned", "journey.operationUncovered"], (f) => edit(f, ONTOLOGY, (d) => {
    d.nodes.push({ id: "operation.ghost", kind: "operation", name: "Ghost", parent: "section.domain", effects: ["x"],
      links: [{ rel: "writes", to: "entity.MessageDraft" }, { rel: "reads", to: "entity.ContactRecord" }] });
  })],
  ["conflicting direct policies", ["authz.policyConflict"], (f) => edit(f, ONTOLOGY, (d) => {
    d.nodes.find((n: any) => n.id === "operation.contact.save").links.push({ rel: "governs", to: "policy.pairConsent", direction: "in" });
  })],
  ["broken journey", ["journey.startMissing", "journey.nextDangling", "journey.stepRefMissing", "journey.noEnd"], (f) => edit(f, "journeys/J.contact.yaml", (d) => {
    d.start = "ghost";
    Object.assign(d.steps[0], { screen: "screen.ghost", next: [{ to: "ghost" }] });
    for (const st of d.steps) if (st.kind === "end") st.kind = "action";
  })],
  ["empty screen and actorless affordance", ["screen.noComponents", "journey.screenUncovered", "affordance.incomplete"], (f) => edit(f, ONTOLOGY, (d) => {
    d.nodes.push({ id: "screen.empty", kind: "screen", name: "Empty", parent: "section.ui" });
    delete d.nodes[0].children[0].children[0].children[0].actor;
  })],
  ["incomplete purpose and claims", ["purpose.beneficiaryKind", "theory.indicator", "theory.method", "theory.beneficiary", "theory.outcomeUnlinked"], (f) =>
    edit(edit(f, "purpose.yaml", (d) => { d.purposes[0].beneficiaries = ["ext.ghost"]; }), "theory.yaml", (d) => {
      Object.assign(d.claims[0], { indicator: "  ", evaluationMethod: "", beneficiaries: [] });
      d.claims.push({ ...d.claims[1], id: "T9" });
    })],
  ["purpose without beneficiaries", ["purpose.beneficiary"], (f) => edit(f, "purpose.yaml", (d) => { d.purposes[0].beneficiaries = []; })],
  ["broadcast, groups and a multi-account connection", ["topology.recipientArray", "topology.groupEnabled", "topology.pairCardinality", "semantic:topology.multiRecipient"],
    (f) => edit(f, ONTOLOGY, (d) => {
      const byId = (id: string) => d.nodes.find((n: any) => n.id === id);
      byId("operation.contact.save").effects.push("Notify Recipients[] at once");
      const conn = byId("entity.Connection");
      conn.fields = conn.fields.filter((x: any) => x.name !== "secondAccountId").concat({ name: "members", type: "list<ref:entity.Account>" });
      byId("entity.MessageDraft").name = "Group chat";
    })],
];

describe("findings parity with artyfact's six rule packs", () => {
  it("Keep in Touch reproduces artyfact's findings, including kit.unpinned for auth", () => {
    const expected = theirs(sys);
    expect(expected).toContain("kit.unpinned auth");
    expect(expected.length).toBe(15);
    expect(ours(evaluate(template, load(sys)))).toEqual(expected);
  });

  it.each(mutations)("%s", (_name, rules, mutate) => {
    const files = mutate(sys);
    const expected = theirs(files);
    const r = evaluate(template, load(files));
    expect(ours(r)).toEqual(expected);
    for (const rule of rules) expect(expected.some((p) => p.startsWith(`${rule} `))).toBe(true);
  });
});

describe("judging artyfact semantic candidates", () => {
  const effect = (text: string) => load(edit(sys, ONTOLOGY, (d) => {
    d.nodes.find((n: any) => n.id === "operation.contact.save").effects.push(text);
  }));
  const verdict = async (text: string) => (await evaluateAndJudge(template, effect(text), fakeSystemOne())).findings
    .filter((f) => f.rule === "semantic:topology.multiRecipient").map((f) => [f.level, f.judgment?.status]);

  it("passes a benign answer and fails a harmful one", async () => {
    expect(await verdict("Reply to the recipient who wrote")).toEqual([["pass", "confident"]]);
    expect(await verdict("Reply to the recipient #s1harm")).toEqual([["error", "confident"]]);
  });
});
