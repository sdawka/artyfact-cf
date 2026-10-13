// Delete with the v1 reader: this is the migration's acceptance test (docs/design/ontology.md §2a), and it goes when
// `convertV1` and the engine's artyfact v1 adapter are removed after the migration release.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artyfactTemplateStore, evaluate, loadArtyfactSystem, readTree, type Finding } from "@artyfact/ontology";
import { readDir } from "@artyfact/ontology/artyfact/node";
import { convertV1 } from "@artyfact/ontology/codec/v1";
import { loadGenome } from "@artyfact/model";
import { canon, composeTemplates } from "@artyfact/ontology";
import { loadMetaTemplate, metaTemplates } from "../src/index";
import { files as bundled } from "../src/generated/files";

const templatesDir = Object.fromEntries(Object.entries(bundled).filter(([p]) => !p.startsWith("rule-packs/")));
const v1 = readDir(join(__dirname, "../../ontology/test/fixtures/artyfact/keep-in-touch-system"));
const SYSTEM = "template.system.social-networking.cloudflare@1";
const template = composeTemplates(
  { template: loadMetaTemplate(SYSTEM), self: "system.keep-in-touch" },
  [{ template: loadMetaTemplate("template.thing.cloudflare-worker-webapp@1"), self: "thing.webapp" }],
);
// The v1 adapter names its base template; the tree names the root's, which the composed template keeps.
const v1Graph = { ...loadArtyfactSystem(v1, { templates: artyfactTemplateStore(templatesDir) }), template: SYSTEM };
const v2Graph = readTree(convertV1(v1, templatesDir), metaTemplates);

/** Kinds v1 left parentless and the tree places (the three intended parent differences). */
const PLACED = new Set(["purpose", "claim", "external", "feature", "commitment", "journey", "requirement"]);
const key = (f: Finding) => `${f.rule} ${f.subject ?? ""} ${f.level}`;

describe("Genome v2 findings parity (Keep in Touch)", () => {
  const before = evaluate(template, v1Graph).findings;
  const after = evaluate(template, v2Graph).findings;
  const afterKeys = new Set(after.map(key)), beforeKeys = new Set(before.map(key));

  it("the converted tree raises no finding the v1 Genome did not", () => {
    expect(v2Graph.template).toBe(template.ref);
    expect(after.filter((f) => f.rule === "graph.templateMismatch")).toEqual([]);
    expect(after.map(key).filter((k) => !beforeKeys.has(k))).toEqual([]);
  });

  it("drops exactly the missing-parent findings of the kinds the tree places", () => {
    const kinds = new Map(v1Graph.nodes.map((n) => [n.id, n.kind]));
    const dropped = before.filter((f) => !afterKeys.has(key(f)));
    expect(dropped.every((f) => f.rule === "tree.parentRequired" && PLACED.has(kinds.get(f.subject!)!))).toBe(true);
    const placed = v1Graph.nodes.filter((n) => PLACED.has(n.kind)).map((n) => n.id).sort();
    expect(dropped.map((f) => f.subject).sort()).toEqual(placed);
    expect(after.length).toBe(before.length - placed.length);
    expect(after.length).toBeGreaterThan(30);
  });
});

// TODO delete with the v1 reader.
describe("Genome v2 projection parity (Keep in Touch)", () => {
  const example = new Map(Object.entries(readDir(join(__dirname, "../../../examples/keep-in-touch-system"))).filter(([p]) => /\.ya?ml$/.test(p)));
  const m = loadGenome(example, { templates: metaTemplates });
  const kind = new Map(m.graph.nodes.map((n) => [n.id, n.kind]));
  /** A Thing's `requires` link to its own `$self` criterion: the one link the v1 adapter has no counterpart for. */
  const selfRequirement = (l: { from: string; rel: string }) => l.rel === "requires" && kind.get(l.from) === "thing";
  /** Template node lists name per-Thing criteria and hooks `$thing` in the legacy shape and `$self` in meta@1. */
  const selfIds = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.replace("$thing", "$self") : x)) : v);
  const sortHookCriteria = (n: { kind: string; fields: Record<string, unknown> }) =>
    n.kind === "hook" ? { ...n.fields, criteria: [...(n.fields.criteria as string[])].sort() }
      : n.kind === "template" ? { ...n.fields, ...("criteria" in n.fields && { criteria: selfIds(n.fields.criteria) }), ...("hooks" in n.fields && { hooks: selfIds(n.fields.hooks) }) }
      : n.fields;
  const nodes = (g: typeof m.graph) => new Map(g.nodes.map((n) => [n.id, { kind: n.kind, provisional: !!n.provisional, fields: canon(sortHookCriteria(n)) }]));
  const links = (g: typeof m.graph) => [...new Set(g.links.filter((l) => !selfRequirement(l)).map((l) => `${l.from} ${l.rel} ${l.to} ${l.certainty ?? "declared"}`))].sort();
  const parent = (g: { nodes: { id: string; parent?: string | null }[] }) => new Map(g.nodes.map((n) => [n.id, n.parent ?? null]));

  it("loadGenome projects the committed example to the v1 adapter's nodes (kinds, fields, provisional) and links (with certainty)", () => {
    expect(nodes(m.graph)).toEqual(nodes(v1Graph));
    expect(links(m.graph)).toEqual(links(v1Graph));
    expect(m.graph.links.filter(selfRequirement).map((l) => `${l.from} ${l.to}`)).toEqual(["thing.webapp C.thing.webapp.checks"]);
  });

  it("places exactly the kinds the tree places, under their expected parents", () => {
    const before = parent(v1Graph), after = parent(m.graph);
    const moved = v1Graph.nodes.filter((n) => before.get(n.id) !== after.get(n.id));
    expect([...new Set(moved.map((n) => n.kind))].filter((k) => !PLACED.has(k))).toEqual([]);
    const system = m.system.id;
    for (const n of moved) {
      if (["purpose", "claim", "external", "feature", "commitment"].includes(n.kind)) expect(after.get(n.id), n.id).toBe(system);
      else if (n.kind === "journey") expect(["system", "thing"], n.id).toContain(kind.get(after.get(n.id)!));
      else {
        const subjects = v1Graph.links.filter((l) => l.from === n.id && l.rel === "subject").map((l) => l.to);
        expect(after.get(n.id), n.id).toBe(subjects[0] ?? n.fields.thing);
      }
    }
    expect(new Set(moved.map((n) => n.kind))).toEqual(PLACED);
  });
});
