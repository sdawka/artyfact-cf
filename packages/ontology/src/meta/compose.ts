import { canon } from "../canon.ts";
import type { MapLayer } from "../genome/view.ts";
import type { Constraints, Relation, TemplateNode } from "./schema.ts";
import { instantiateNodes, templateHash, type Template } from "./template.ts";

/** A loaded template and the node that instantiates it (the System at the root, or a Thing); without `self` its prefilled nodes stay as declared. */
export interface TemplateUse { template: Template; self?: string }

export class TemplateCompositionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateCompositionError";
  }
}

const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** Merges `items` by id: an identical redeclaration is kept once, a different one is an error. */
function byId<T extends { id: string }>(what: string, lists: T[][]): T[] {
  const out = new Map<string, T>();
  for (const x of lists.flat()) {
    const had = out.get(x.id);
    if (had !== undefined && !same(had, x)) throw new TemplateCompositionError(`${what} ${x.id} is declared differently by two templates`);
    out.set(x.id, x);
  }
  return [...out.values()];
}

/** Relations of the same name unite their endpoints and keep the first description; any other difference is an error. */
function relationsOf(all: Template[]): Record<string, Relation> {
  const out: Record<string, Relation> = {};
  for (const t of all) {
    for (const [name, r] of Object.entries(t.relations)) {
      const had = out[name];
      if (had === undefined) { out[name] = r; continue; }
      const { from: f1, to: t1, description: _d1, ...rest1 } = had;
      const { from: f2, to: t2, description: _d2, ...rest2 } = r;
      if (!same(rest1, rest2)) throw new TemplateCompositionError(`relation ${name} is declared differently by two templates`);
      out[name] = { ...had, from: union(f1, f2), to: union(t1, t2) };
    }
  }
  return out;
}

/** The System's layers in its order, then any layer a Thing template adds. */
function layersOf(all: Template[]): MapLayer[] | undefined {
  const declared = all.filter((t) => t.view?.layers !== undefined);
  if (!declared.length) return undefined;
  const out = new Map<string, MapLayer>();
  for (const t of declared) for (const l of t.view!.layers!) if (!out.has(l.id)) out.set(l.id, l);
  return [...out.values()];
}

/**
 * One evaluable template for a System that mixes templates: the System's template with the kinds, relations,
 * constraints, rules, criteria, questions and prefilled nodes of every Thing template it uses (design §3). Shared kinds
 * must be declared identically; a kind, constraint, rule pack (same id), criterion or question declared differently
 * by two templates is a `TemplateCompositionError`. Relations of the same name unite their endpoints. Prefilled nodes
 * (criteria and hooks included) are instantiated for the node that uses the template; two prefilled nodes with one id
 * and different content (two templates, or one template used by two Things without `$self` in the id) are a
 * `TemplateCompositionError`. The System's Map layers come first, in its order; Thing
 * templates may append layers it does not declare. Everything that belongs to the root (root criteria and checks, text
 * defaults, defects, root `files`) is the System's. The result keeps the System template's id and version, so the
 * graph (whose `template` is the root's ref) names it.
 */
export function composeTemplates(system: TemplateUse, things: TemplateUse[]): Template {
  const uses = [system, ...things];
  const all = uses.map((u) => u.template);
  const s = system.template;

  const kinds: Template["kinds"] = {};
  for (const t of all) {
    for (const [k, def] of Object.entries(t.kinds)) {
      if (k in kinds && !same(kinds[k], def)) throw new TemplateCompositionError(`kind ${k} is declared differently by two templates`);
      kinds[k] = def;
    }
  }
  const constraint = <K extends keyof Constraints>(key: K) =>
    byId<{ id: string }>(`constraint ${key}`, all.map((t) => t.constraints[key])) as Constraints[K];
  const rules = byId("rule pack", all.map((t) => t.rules));
  const nodes = new Map<string, TemplateNode>();
  for (const u of uses) {
    for (const n of u.self === undefined ? u.template.nodes : instantiateNodes(u.template, u.self)) {
      const had = nodes.get(n.id);
      // Without `self` a `$self` id is a pattern, not a node: the first one stands for all.
      if (had !== undefined && !same(had, n) && !n.id.includes("$self")) throw new TemplateCompositionError(`prefilled node ${n.id} is declared differently by two templates (or two uses of one); template its id with $self`);
      nodes.set(n.id, n);
    }
  }
  const layers = layersOf(all);

  const { hash: _hash, view: _view, ...base } = s;
  const body: Omit<Template, "hash"> = {
    ...base,
    lineage: union(s.lineage, all.flatMap((t) => t.lineage)),
    edges: [...new Map(all.flatMap((t) => t.edges).map((e) => [canon(e), e])).values()],
    kinds,
    relations: relationsOf(all),
    constraints: {
      forbiddenCycles: constraint("forbiddenCycles"),
      incompatible: constraint("incompatible"),
      exclusive: constraint("exclusive"),
      exactlyOne: constraint("exactlyOne"),
      complete: constraint("complete"),
    },
    criteria: byId("criterion", all.map((t) => t.criteria)),
    rules,
    questions: byId("question", all.map((t) => t.questions)),
    nodes: [...nodes.values()],
    ...(layers && { view: { ...s.view, layers } }),
  };
  return { ...body, hash: templateHash(body) };
}
