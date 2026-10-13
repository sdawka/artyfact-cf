// Test helpers: reads a v2 Genome tree from disk into an engine Graph and composes the meta@1 templates it pins.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseNodeFile, type Graph, type GraphLink, type GraphNode, type TemplateInput } from "@artyfact/ontology";
import { metaTemplateSource } from "../src/index";

export const GENERIC_THINGS = [
  "template.thing.cloudflare-worker-service@1",
  "template.thing.ts-library@1",
  "template.thing.cli@1",
  "template.thing.static-site@1",
];
export const SYSTEM = "template.system.dev-platform.cloudflare@1";

export const COMPOSED = "template.test.dev-platform-composed@1";

type Source = Record<string, any>;
const source = (ref: string): Source => {
  const s = metaTemplateSource(ref);
  if (!s) throw new Error(`no meta@1 template ${ref}`);
  return s;
};

const union = <T>(a: T[] = [], b: T[] = []): T[] => [...new Set([...a, ...b])];

/**
 * One evaluable template from several: the union of their kinds and relations. A kind several templates declare must be
 * declared identically, so that the shared vocabulary (system, thing, section, module) cannot drift. Relation endpoints
 * are united, which is what lets a page of a static site `calls` an endpoint of a Worker. Rule packs, prefilled nodes and
 * the System's view come from the System template.
 */
export function compose(refs: string[], id = "template.test.dev-platform-composed"): TemplateInput {
  const sources = refs.map(source);
  const kinds: Record<string, unknown> = {};
  const relations: Record<string, Source> = {};
  for (const s of sources) {
    for (const [k, def] of Object.entries(s.kinds as Source)) {
      if (k in kinds && JSON.stringify(kinds[k]) !== JSON.stringify(def)) throw new Error(`kind ${k} is declared differently by two templates`);
      kinds[k] = def;
    }
    for (const [r, def] of Object.entries((s.relations ?? {}) as Source)) {
      const had = relations[r];
      relations[r] = had ? { ...had, from: union(had.from, def.from), to: union(had.to, def.to) } : { ...def };
    }
  }
  const system = sources.find((s) => s.id === SYSTEM.slice(0, -2)) ?? sources[0]!;
  return { id, version: 1, meta: 1, kinds, relations, rules: system.rules, view: system.view } as TemplateInput;
}

const skip = (name: string) => name.startsWith(".");

/** Reads a Genome tree (`node.yaml` per directory) into a Graph: the enclosing directory's node is the parent. */
export function readGenome(dir: string): { graph: Graph; nodes: Map<string, ReturnType<typeof parseNodeFile>> } {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const parsed = new Map<string, ReturnType<typeof parseNodeFile>>();
  const templates = new Map<string, string>();
  const walk = (path: string, parent?: string) => {
    let id = parent;
    const file = join(path, "node.yaml");
    if (statSync(path).isDirectory() && readdirSync(path).includes("node.yaml")) {
      const n = parseNodeFile(parseYaml(readFileSync(file, "utf8")));
      parsed.set(n.id, n);
      nodes.push({ id: n.id, kind: n.kind, ...(parent !== undefined && { parent }), fields: n.fields ?? {} });
      for (const l of n.links ?? []) links.push({ from: n.id, rel: l.rel, to: l.to, ...(l.certainty && { certainty: l.certainty }) });
      if (n.template) { templates.set(n.template, n.kind); links.push({ from: n.id, rel: "pinned", to: n.template }); }
      id = n.id;
    }
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      if (!skip(name) && statSync(child).isDirectory()) walk(child, id);
    }
  };
  walk(dir);
  for (const [ref, kind] of templates) nodes.push({ id: ref, kind: "template", fields: { kind } });
  return { graph: { template: COMPOSED, nodes, links, declarations: [], evidence: [] }, nodes: parsed };
}
