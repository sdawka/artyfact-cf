import { describe, expect, it } from "vitest";
import {
  ARTYFACT_GENOME, artyfactGenome, evaluateAndJudge, fakeSystemOne, artyfactMetaStore, artyfactSchema, checkTemplateForm, evaluate, graphHash, instantiateNodes,
  loadArtyfactSystem, loadArtyfactTemplate, loadTemplate, parseGraph, type Graph, type Readiness,
} from "../src/index.ts";
import { edit, referenceFacts, referenceFindings, referenceModel, systemFiles, templateFiles, type Files } from "./artyfact-reference.ts";
import * as packs from "./vendor/artyfact/packs.ts";

const sys = systemFiles();
const tpls = templateFiles();
const base = loadTemplate(artyfactGenome);
const graph = loadArtyfactSystem(sys, { templates: tpls });
const pairs = (fs: { rule: string; subject?: string }[]) => [...new Set(fs.map((f) => `${f.rule} ${f.subject ?? ""}`))].sort();
const ours = (r: Readiness) => pairs(r.findings.filter((f) => f.pack?.startsWith("artyfact.")));
const allPacks = [packs.metamodel, packs.readiness, packs.authorization, packs.journeys, packs.theory, packs.topologyPrivatePairs];
const theirs = (files: Files) => pairs(referenceFindings(referenceModel(files, tpls), allPacks));
const ONTOLOGY = "things/webapp/ontology.yaml";

describe("artyfact YAML adapter", () => {
  const m = referenceModel(sys, tpls);
  const facts = referenceFacts(m).relations;
  const rows = (rel: string) => (facts.get(rel) ?? []).map((t) => t.map(String));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const has = (from: string, rels: string[], to: string, certainty?: string) =>
    graph.links.some((l) => l.from === from && rels.includes(l.rel) && l.to === to && (certainty === undefined || l.certainty === certainty));

  it("emits a canonical graph under the base template, deterministically", () => {
    expect(parseGraph(graph)).toEqual(graph);
    expect(graph.template).toBe(ARTYFACT_GENOME);
    expect(graphHash(loadArtyfactSystem(sys, { templates: tpls }))).toBe(graphHash(graph));
  });

  it("keeps every id artyfact knows as a node, with the same kind for node facts", () => {
    const known = rows("known").map(([id]) => id);
    expect(known.length).toBeGreaterThan(250);
    expect(known.filter((id) => !byId.has(id))).toEqual([]);
    expect(Object.keys(m.index.byId).filter((id) => !byId.has(id))).toEqual([]);
    expect(rows("node").filter(([id, kind]) => byId.get(id)?.kind !== kind)).toEqual([]);
  });

  it("keeps every link, ref and parent fact", () => {
    const cross = artyfactSchema.Relation.options as readonly string[];
    const via: Record<string, string[]> = {
      links: [...cross], refines: ["refines"], beneficiaries: ["beneficiary"], subjects: ["subject"], sourceRefs: ["sourceRef"],
      acceptanceCriteria: ["acceptance"], screen: ["stepScreen"], operation: ["stepOperation"], external: ["stepExternal"],
    };
    const links = rows("link"), refs = rows("ref"), parents = rows("parent");
    expect([links.length, refs.length, parents.length].every((n) => n > 50)).toBe(true);
    expect(links.filter(([f, r, t, c]) => !has(f, [r], t, c))).toEqual([]);
    expect(refs.filter(([f, v, t]) => (v === "parent" ? byId.get(f)?.parent !== t : !has(f, via[v] ?? [], t)))).toEqual([]);
    expect(parents.filter(([c, p]) => byId.get(c)?.parent !== p)).toEqual([]);
  });

  it("keeps unresolved step targets as fields, not links", () => {
    const step = byId.get("J.updates/u1")!;
    expect(step).toMatchObject({ kind: "step", parent: "J.updates", fields: { step: "u1", unresolved: true } });
    expect(graph.links.filter((l) => l.from === "J.updates/u1").map((l) => l.rel)).toEqual(["stepNext"]);
  });
});

describe("artyfact templates as meta@1", () => {
  const store = artyfactMetaStore(tpls);
  const refs = ["template.system.social-networking.cloudflare@1", "template.thing.cloudflare-worker-webapp@1", "template.thing.vue-webapp@1"];

  it("the base template is form valid", () => {
    expect(checkTemplateForm(base)).toMatchObject({ valid: true, findings: [] });
  });

  it.each(refs)("%s converts to a form-valid template extending the base", (ref) => {
    const t = loadTemplate(loadArtyfactTemplate(ref, tpls), store);
    expect(t.lineage).toEqual([ref, ARTYFACT_GENOME]);
    expect(checkTemplateForm(t, store)).toMatchObject({ valid: true, findings: [] });
  });

  it("instantiated template nodes match what the loader emits", () => {
    const t = loadTemplate(store.get("template.thing.cloudflare-worker-webapp@1"), store);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const all = instantiateNodes(t, "thing.webapp");
    const prefilled = all.filter((n) => byId.get(n.id)?.fields.fromTemplate !== undefined || n.kind === "template");
    expect(byId.get("binding.d1")?.fields.fromTemplate).toBeUndefined();
    expect(prefilled.length).toBeGreaterThan(all.length - 3);
    expect(byId.get("policy.authentication")?.provisional).toBe(true);
    for (const n of prefilled) {
      expect(byId.get(n.id)).toMatchObject({ kind: n.kind, fields: n.fields, ...(n.parent && { parent: n.parent }), ...(n.provisional && { provisional: true }) });
      for (const l of n.links ?? []) expect(graph.links).toContainEqual({ from: n.id, ...l });
    }
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
  ["thing without artifacts", ["thing.noArtifact"], (f) => edit(f, "things/webapp/thing.yaml", (d) => { d.artifacts = []; })],
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
    expect(ours(evaluate(base, graph))).toEqual(expected);
  });

  it.each(mutations)("%s", (_name, rules, mutate) => {
    const files = mutate(sys);
    const expected = theirs(files);
    const r = evaluate(base, loadArtyfactSystem(files, { templates: tpls }) as Graph);
    expect(ours(r)).toEqual(expected);
    for (const rule of rules) expect(expected.some((p) => p.startsWith(`${rule} `))).toBe(true);
  });
});

describe("judging artyfact semantic candidates", () => {
  const effect = (text: string) => loadArtyfactSystem(edit(sys, ONTOLOGY, (d) => {
    d.nodes.find((n: any) => n.id === "operation.contact.save").effects.push(text);
  }), { templates: tpls });
  const verdict = async (text: string) => (await evaluateAndJudge(base, effect(text), fakeSystemOne())).findings
    .filter((f) => f.rule === "semantic:topology.multiRecipient").map((f) => [f.level, f.judgment?.status]);

  it("passes a benign answer and fails a harmful one", async () => {
    expect(await verdict("Reply to the recipient who wrote")).toEqual([["pass", "confident"]]);
    expect(await verdict("Reply to the recipient #s1harm")).toEqual([["error", "confident"]]);
  });
});
