import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { readDir } from "../src/adapters/artyfact/node.ts";
import { convertV1 } from "../src/codec/v1.ts";
import { templateDir, GenomeTreeError, graphHash, isLegacyGenome, loadArtyfactSystem, readTree, type Graph } from "../src/index.ts";

/** The meta@1 `template.yaml` sources, as `@artyfact/templates`' `metaTemplates` serves them. */
const metaStore = (files: Record<string, string>) => ({
  get: (ref: string) => { const t = files[`${templateDir(ref)}/template.yaml`]; return t === undefined ? undefined : parseYaml(t); },
});
// The v1 Keep in Touch Genome as it was before the migration; the converted tree is the example itself.
const V1 = join(__dirname, "fixtures/artyfact/keep-in-touch-system");
const FIXTURE = join(__dirname, "../../../examples/keep-in-touch-system");
const TPL = readDir(join(__dirname, "../../templates"));
const templates = metaStore(TPL);
const v1 = readDir(V1);
// The app repo's v1 source-map.yaml, which the conversion moves onto the nodes' `files`.
const SOURCE_MAP = readFileSync(join(__dirname, "fixtures/artyfact/keep-in-touch-app.source-map.yaml"), "utf8");
const tree = convertV1(v1, TPL, { sourceMap: SOURCE_MAP });
const v1Graph = loadArtyfactSystem(v1, { templates: TPL });
const v2Graph = readTree(tree, templates);

/** Kinds v1 left parentless that the tree places (design §2, the three intended parent differences). */
const PLACED = new Set(["purpose", "claim", "external", "feature", "commitment", "journey", "requirement"]);
const sortBy = <T>(xs: T[], key: (x: T) => string) => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
// The converter leaves out v1 projection artefacts the tree derives or defaults: `owningThing`, `revision: 1`, step defaults.
const dropArtefacts = ({ owningThing: _o, ...f }: Record<string, unknown>) => {
  const { revision, kind, unresolved, ...rest } = f;
  return { ...rest, ...(revision !== 1 && revision !== undefined && { revision }), ...(kind !== "action" && kind !== undefined && { kind }), ...(unresolved === true && { unresolved }) };
};
/** A Thing's `requires` link to its own `$self` criterion: the tree's one link the v1 adapter has no counterpart for. */
const selfRequirement = (g: Graph) => {
  const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
  return (l: Graph["links"][number]) => l.rel === "requires" && kind.get(l.from) === "thing";
};
/** A template's per-Thing criterion and hook ids: `$thing` in the legacy shape, `$self` in meta@1. */
const selfIds = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.replace("$thing", "$self") : x)) : v);
const comparable = (g: Graph) => ({
  nodes: sortBy(g.nodes, (n) => `${n.id} ${n.kind}`).map(({ parent, ...n }) => ({
    ...n,
    ...(parent !== undefined && !PLACED.has(n.kind) && { parent }),
    // A shared hook lists its criteria in tree order rather than v1 file order.
    fields: dropArtefacts(n.kind === "hook" ? { ...n.fields, criteria: [...(n.fields.criteria as string[])].sort() }
      : n.kind === "template" ? { ...n.fields, ...("criteria" in n.fields && { criteria: selfIds(n.fields.criteria) }), ...("hooks" in n.fields && { hooks: selfIds(n.fields.hooks) }) }
      : n.fields),
  })),
  // v1 left the certainty of derived links unset; the tree projects an absent certainty as `declared`.
  links: sortBy(g.links.filter((l) => !selfRequirement(g)(l)).map((l) => `${l.from} ${l.rel} ${l.to} ${l.certainty ?? "declared"}`), (x) => x),
});

describe("convertV1 (Keep in Touch)", () => {
  it("writes the tree the fixture holds", () => {
    // Exact: regenerating the example from the v1 Genome (with its source map) is a no-op.
    expect(new Map(Object.entries(readDir(FIXTURE)))).toEqual(tree);
    expect(isLegacyGenome(tree.keys())).toBe(false);
  });

  it("lays out the tree (listing snapshot)", () => {
    expect([...tree.keys()].join("\n")).toMatchSnapshot();
  });

  it("projects to the v1 adapter's graph, apart from the intended parents", () => {
    expect(comparable(v2Graph)).toEqual(comparable(v1Graph));
    expect(v2Graph.nodes).toHaveLength(v1Graph.nodes.length);
    expect(v2Graph.links.filter(selfRequirement(v2Graph)).map((l) => `${l.from} ${l.to}`)).toEqual(["thing.webapp C.thing.webapp.checks"]);
    expect(v2Graph.links.filter((l) => !selfRequirement(v2Graph)(l))).toHaveLength(v1Graph.links.length);
  });

  it("places purposes, claims, externals, features, commitments, journeys and requirements", () => {
    const parent = new Map(v2Graph.nodes.map((n) => [n.id, n.parent]));
    const kinds = new Map(v1Graph.nodes.map((n) => [n.id, n.kind]));
    for (const n of v1Graph.nodes.filter((x) => ["purpose", "claim", "external", "feature", "commitment"].includes(x.kind))) {
      expect(parent.get(n.id), n.id).toBe("system.keep-in-touch");
    }
    expect(parent.get("J.contacts")).toBe("thing.webapp");
    expect(parent.get("J.updates")).toBe("system.keep-in-touch");
    expect(parent.get("S.webapp.scope")).toBe("thing.webapp");
    expect(parent.get("S.webapp.screens")).toBe("screen.signin");
    for (const n of v1Graph.nodes.filter((x) => x.kind === "requirement")) {
      const subjects = v1Graph.links.filter((l) => l.from === n.id && l.rel === "subject").map((l) => l.to);
      expect(parent.get(n.id)).toBe(subjects[0] ?? n.fields.thing);
      expect(kinds.has(parent.get(n.id)!)).toBe(true);
    }
  });

  it("keeps every node id and criterion id", () => {
    const ids = new Set(v2Graph.nodes.map((n) => n.id));
    expect(v1Graph.nodes.map((n) => n.id).filter((id) => !ids.has(id))).toEqual([]);
    const criteria = v1Graph.nodes.filter((n) => n.kind === "criterion").map((n) => n.id);
    expect(criteria.length).toBeGreaterThan(20);
    for (const id of criteria) expect([...tree.values()].some((t) => t.includes(`id: ${id}\n`)), id).toBe(true);
  });

  it("puts each criterion on its subject node and shares a hook by id", () => {
    expect(tree.get("node.yaml")).toContain("id: C.system.structure");
    expect(tree.get("thing.webapp/section.ui/screen.people/node.yaml")).toContain("id: C.webapp.screen.people");
    const shared = v1Graph.nodes.find((n) => n.kind === "hook" && (n.fields.criteria as string[]).length > 1);
    if (shared) expect([...tree.values()].filter((t) => t.includes(`id: ${shared.id}\n`))).toHaveLength(1);
  });

  it("keeps the label of every v1 cross link, which the graph does not carry", () => {
    const v1Labels = Object.entries(v1).filter(([p]) => /ontology\.yaml$|externals\.yaml$/.test(p)).flatMap(([, t]) => [...t.matchAll(/label: ([^,}\n]+)/g)].map((m) => m[1]!.trim()));
    expect(v1Labels).toHaveLength(4);
    const v2Labels = [...tree.values()].flatMap((t) => [...t.matchAll(/label: ([^,}\n]+)/g)].map((m) => m[1]!.trim()));
    expect(v2Labels.sort()).toEqual(v1Labels.sort());
    expect(tree.get("thing.webapp/section.ui/screen.signin/node.yaml")).toContain("{ rel: references, to: ext.providers, label: identity provider }");
  });

  it("names step directories by local id and keeps evolutions verbatim", () => {
    expect(tree.has("thing.webapp/J.contacts/s1/node.yaml")).toBe(true);
    expect(tree.get("thing.webapp/J.contacts/s1/node.yaml")).toMatch(/^id: J\.contacts\/s1\n/);
    for (const [p, t] of Object.entries(v1)) if (p.startsWith("evolutions/")) expect(tree.get(p)).toBe(t);
  });

  it("is deterministic whatever the input order", () => {
    const reversed = Object.fromEntries(Object.entries(v1).reverse());
    expect([...convertV1(reversed, TPL, { sourceMap: SOURCE_MAP })]).toEqual([...tree]);
    expect(graphHash(readTree(new Map([...tree].reverse()), templates))).toBe(graphHash(v2Graph));
  });

  it("moves the app's source map onto the nodes it names, dropping the genome pseudo-node", () => {
    const at = (id: string) => [...tree].find(([p, t]) => p.endsWith("node.yaml") && t.startsWith(`id: ${id}\n`))![1];
    expect(parseYaml(at("operation.contact.save")).files).toEqual(["src/worker/routes/contacts.ts", "public/people/add-contact-dialog.js"]);
    expect(parseYaml(at("thing.webapp")).files).toEqual(["src/index.ts"]);
    expect([...tree.values()].some((t) => t.includes("system/**"))).toBe(false);
    expect([...convertV1(v1, TPL)].some(([, t]) => /^files:/m.test(t))).toBe(false);
  });

  it("refuses a source map naming an unknown node or of the wrong shape", () => {
    expect(() => convertV1(v1, TPL, { sourceMap: "- glob: src/x.ts\n  nodes: [screen.ghost]\n" })).toThrow(/src\/x\.ts names screen\.ghost, which is not a node/);
    expect(() => convertV1(v1, TPL, { sourceMap: "src/x.ts: screen.people\n" })).toThrow(/expected a list of \{glob, nodes\} entries/);
  });

  it("refuses a criterion whose owner is not the nearest Thing or System above its subject", () => {
    const bad = { ...v1, "criteria.yaml": v1["criteria.yaml"]!.replace("ownerId: system.keep-in-touch", "ownerId: thing.webapp") };
    expect(() => convertV1(bad, TPL)).toThrow(GenomeTreeError);
    expect(() => convertV1(bad, TPL)).toThrow(/is owned by thing\.webapp/);
  });
});
