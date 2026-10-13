import { describe, expect, it } from "vitest";
import {
  ARTYFACT_GENOME, artyfactGenome, artyfactMetaStore, artyfactSchema, checkTemplateForm, checkViewHints, evaluate, graphHash, instantiateNodes,
  loadArtyfactSystem, loadArtyfactTemplate, loadTemplate, parseGraph, resolveKindView, ARTYFACT_KINDS, type Readiness,
} from "../src/index.ts";
import { referenceFacts, referenceFindings, referenceModel, systemFiles, templateFiles } from "./artyfact-reference.ts";
import * as packs from "./vendor/artyfact/packs.ts";

const sys = systemFiles();
const tpls = templateFiles();
const base = loadTemplate(artyfactGenome);
const graph = loadArtyfactSystem(sys, { templates: tpls });
const pairs = (fs: { rule: string; subject?: string }[]) => [...new Set(fs.map((f) => `${f.rule} ${f.subject ?? ""}`))].sort();
const ours = (r: Readiness) => pairs(r.findings.filter((f) => f.pack?.startsWith("artyfact.")));

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

describe("the base template", () => {
  it("keeps only the generic packs; the domain packs belong to the templates", () => {
    expect(base.rules.map((r) => r.id)).toEqual(["artyfact.facts", "artyfact.metamodel"]);
  });

  it("reproduces artyfact's metamodel findings", () => {
    expect(ours(evaluate(base, graph))).toEqual(pairs(referenceFindings(referenceModel(sys, tpls), [packs.metamodel])));
  });

  it("declares legal parents for what the System and the Things hold, and a view for every kind", () => {
    expect(base.kinds.purpose!.parents).toEqual(["system"]);
    expect(base.kinds.journey!.parents).toEqual(["system", "thing"]);
    expect(base.kinds.requirement!.parents).toEqual(expect.arrayContaining(["screen", "operation", "thing", "system"]));
    expect(checkViewHints(base)).toEqual([]);
    for (const k of ARTYFACT_KINDS) expect(base.kinds[k]!.view, k).toMatchObject({ glyph: expect.any(String), colour: expect.any(String), label: expect.any(String) });
    expect(resolveKindView(base, "screen")).toMatchObject({ label: "Screen", glyph: "▭", layer: "experience", title: "name" });
  });
});
