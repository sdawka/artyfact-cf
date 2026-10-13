import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import * as schema from "./schema.ts";
import { index, type ModelIndex } from "./model-index.ts";

export interface ParseIssue { path: PropertyKey[]; message: string }
/** A non-fatal problem found while loading, e.g. an unknown key the schema dropped (often a typo). */
export interface ModelWarning extends ParseIssue { file: string }

export class ModelParseError extends Error {
  readonly file: string;
  readonly issues: ParseIssue[];
  constructor(file: string, issues: ParseIssue[]) {
    super(`${file}: ${issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; ")}`);
    this.name = "ModelParseError";
    this.file = file;
    this.issues = issues;
  }
}

export interface TemplateStore {
  get(ref: string /* "template.thing.x@1" */): schema.Template | undefined;
}

export interface SystemModel {
  revision?: string;
  system: schema.SystemFile;
  purposes: schema.Purpose[];
  externals: schema.Externals[];
  claims: schema.TheoryClaim[];
  description?: schema.Description;
  kits: schema.KitsFile;
  /** Things with `sections` defaulted from their template when omitted. */
  things: schema.ResolvedThing[];
  /** Templates resolved for this model (system template first, then one per distinct Thing templateRef). */
  templates: schema.Template[];
  nodes: schema.OntologyNode[];
  requirements: schema.Requirement[];
  criteria: schema.Criterion[];
  hooks: schema.AssayHook[];
  journeys: schema.Journey[];
  evolutions: schema.Evolution[];
  /** id → file path it was declared in, or the template ref it came from. */
  origin: Record<string, string>;
  /** Unknown keys dropped while parsing Genome files. */
  warnings: ModelWarning[];
  index: ModelIndex;
}

/** Placeholders a template uses for "the Thing (or System) instantiating me"; rebased during resolution. */
export const THING_PLACEHOLDER = "$thing";
export const SYSTEM_PLACEHOLDER = "$system";

export const templateRef = (t: Pick<schema.Template, "id" | "version">) => `${t.id}@${t.version}`;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Keys present in the raw YAML but absent from the parsed value: Zod strips unknown keys silently. */
function droppedKeys(raw: unknown, parsed: unknown, path: PropertyKey[], out: ParseIssue[]) {
  if (Array.isArray(raw) && Array.isArray(parsed)) raw.forEach((x, i) => droppedKeys(x, parsed[i], [...path, i], out));
  else if (isObj(raw) && isObj(parsed)) {
    for (const k of Object.keys(raw)) {
      if (!(k in parsed)) out.push({ path: [...path, k], message: `unknown key "${k}" ignored` });
      else droppedKeys(raw[k], parsed[k], [...path, k], out);
    }
  }
}

function parseFile<S extends z.ZodType>(file: string, text: string, s: S, listKey?: string, warnings?: ModelWarning[]): z.infer<S> {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ModelParseError(file, [{ path: [], message: (e as Error).message }]);
  }
  if (listKey && Array.isArray(raw)) raw = { [listKey]: raw };
  else if (listKey && raw && typeof raw === "object" && !(listKey in raw) && "id" in raw) raw = { [listKey]: [raw] };
  const r = s.safeParse(raw ?? {});
  if (!r.success) throw new ModelParseError(file, r.error.issues.map((i) => ({ path: i.path, message: i.message })));
  if (warnings) {
    const issues: ParseIssue[] = [];
    droppedKeys(raw ?? {}, r.data, [], issues);
    warnings.push(...issues.map((i) => ({ file, ...i })));
  }
  return r.data;
}

type NodeInput = z.infer<typeof schema.OntologyNode> & { children?: unknown[] };

/** Flatten nested `children`, defaulting `parent` to the enclosing node (or `topParent` at top level). */
function flatten(nodes: NodeInput[], topParent: string | undefined): schema.OntologyNode[] {
  const out: schema.OntologyNode[] = [];
  const walk = (ns: NodeInput[], parent: string | undefined) => {
    for (const { children, ...n } of ns) {
      out.push({ ...n, parent: n.parent ?? parent });
      if (children?.length) walk(children as NodeInput[], n.id);
    }
  };
  walk(nodes, topParent);
  return out;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\//, "");

export function loadSystem(files: Map<string, string>, opts: { revision?: string; templates?: TemplateStore } = {}): SystemModel {
  const byPath = new Map([...files].map(([p, t]) => [norm(p), t] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const get = (p: string) => byPath.get(p);
  const warnings: ModelWarning[] = [];
  const parse = <S extends z.ZodType>(file: string, text: string, s: S, listKey?: string) => parseFile(file, text, s, listKey, warnings);
  const systemText = get("system.yaml");
  if (systemText === undefined) throw new ModelParseError("system.yaml", [{ path: [], message: "missing system.yaml" }]);
  const system = parse("system.yaml", systemText, schema.SystemFile);

  const origin: Record<string, string> = {};
  // Ids are unique across every kind (one namespace, as `known/1` and `index.byId` assume).
  const seen = new Map<string, { kind: string; file: string }>();
  const claim = (kind: string, id: string, file: string) => {
    const prev = seen.get(id);
    if (prev !== undefined) throw new ModelParseError(file, [{ path: [], message: `duplicate id ${id} (${kind}; also a ${prev.kind} in ${prev.file})` }]);
    seen.set(id, { kind, file });
    origin[id] = file;
  };
  claim("system", system.id, "system.yaml");
  const collect = <T extends { id: string }>(collection: string, file: string, items: T[]) => {
    for (const it of items) claim(collection, it.id, file);
    return items;
  };

  const purposeText = get("purpose.yaml") ?? get("purposes.yaml");
  const purposes = purposeText === undefined ? [] : collect("purpose", "purpose.yaml", parse("purpose.yaml", purposeText, schema.PurposeFile, "purposes").purposes);
  const ext = get("externals.yaml");
  const externals = ext === undefined ? [] : collect("external", "externals.yaml", parse("externals.yaml", ext, schema.ExternalsFile, "externals").externals);
  const th = get("theory.yaml");
  const claims = th === undefined ? [] : collect("claim", "theory.yaml", parse("theory.yaml", th, schema.TheoryFile, "claims").claims);
  const desc = get("description.yaml");
  const description = desc === undefined ? undefined : parse("description.yaml", desc, schema.Description);
  if (description) {
    collect("feature", "description.yaml", description.features);
    collect("commitment", "description.yaml", description.commitments);
  }
  const kitsText = get("kits.yaml");
  const kits = parse("kits.yaml", kitsText ?? "{}", schema.KitsFile);

  // Instance objects, per owner. Template objects are merged in below.
  const things: { thing: schema.Thing; file: string; dir: string }[] = [];
  const instNodes = new Map<string, schema.OntologyNode[]>(); // owner id → nodes
  const instCriteria = new Map<string, schema.Criterion[]>();
  const instHooks = new Map<string, schema.AssayHook[]>();
  const requirements: schema.Requirement[] = [];
  const journeys: schema.Journey[] = [];
  const evolutions: schema.Evolution[] = [];

  const sysCrit = get("criteria.yaml");
  if (sysCrit !== undefined) {
    const c = parse("criteria.yaml", sysCrit, schema.CriteriaFile, "criteria");
    instCriteria.set(system.id, c.criteria.map((x) => ((origin[x.id] = "criteria.yaml"), x)));
    instHooks.set(system.id, c.hooks.map((x) => ((origin[x.id] = "criteria.yaml"), x)));
  }

  for (const [path, text] of byPath) {
    const m = /^things\/([^/]+)\/thing\.yaml$/.exec(path);
    if (m) things.push({ thing: parse(path, text, schema.Thing), file: path, dir: m[1] });
  }
  for (const { thing, file, dir } of things) {
    claim("thing", thing.id, file);
    const base = `things/${dir}/`;
    const onto = get(base + "ontology.yaml");
    if (onto !== undefined) {
      const nodes = flatten(parse(base + "ontology.yaml", onto, schema.OntologyFile, "nodes").nodes as NodeInput[], thing.id)
        .map((n) => ({ ...n, owningThing: n.owningThing ?? thing.id }));
      for (const n of nodes) origin[n.id] = base + "ontology.yaml";
      instNodes.set(thing.id, nodes);
    }
    const spec = get(base + "spec.yaml");
    if (spec !== undefined) requirements.push(...collect("requirement", base + "spec.yaml", parse(base + "spec.yaml", spec, schema.SpecFile, "requirements").requirements));
    const crit = get(base + "criteria.yaml");
    if (crit !== undefined) {
      const c = parse(base + "criteria.yaml", crit, schema.CriteriaFile, "criteria");
      instCriteria.set(thing.id, c.criteria.map((x) => ((origin[x.id] = base + "criteria.yaml"), x)));
      instHooks.set(thing.id, c.hooks.map((x) => ((origin[x.id] = base + "criteria.yaml"), x)));
    }
  }
  for (const [path, text] of byPath) {
    if (/^journeys\/[^/]+\.ya?ml$/.test(path)) journeys.push(...collect("journey", path, [parse(path, text, schema.Journey)]));
    else if (/^evolutions\/[^/]+\.ya?ml$/.test(path)) evolutions.push(...collect("evolution", path, [parse(path, text, schema.Evolution)]));
  }

  // Template resolution: template objects first (stamped fromTemplate, placeholders rebased), instance ids override.
  const templates: schema.Template[] = [];
  const nodes: schema.OntologyNode[] = [];
  const criteria: schema.Criterion[] = [];
  const hooks: schema.AssayHook[] = [];
  const resolve = (ref: string | null, kind: "system" | "thing", owner: string, file: string): schema.Template | undefined => {
    let tpl: schema.Template | undefined;
    if (ref) {
      tpl = opts.templates?.get(ref);
      const field = kind === "system" ? "template" : "templateRef";
      if (!tpl) throw new ModelParseError(file, [{ path: [field], message: `unknown template ${ref}` }]);
      if (tpl.kind !== kind) throw new ModelParseError(file, [{ path: [field], message: `template ${ref} is a ${tpl.kind} template, expected ${kind}` }]);
      if (!templates.some((t) => templateRef(t) === ref)) templates.push(tpl);
    }
    const rebase = <T extends string | undefined>(v: T): T => (v === THING_PLACEHOLDER || v === SYSTEM_PLACEHOLDER ? owner : v) as T;
    const merge = <T extends { id: string }>(collection: string, fromTpl: T[], inst: T[], out: T[]) => {
      const instById = new Map(inst.map((x) => [x.id, x]));
      const merged = [...fromTpl.map((t) => instById.get(t.id) ?? ((origin[t.id] = ref!), t)), ...inst.filter((x) => !fromTpl.some((t) => t.id === x.id))];
      for (const x of merged) claim(collection, x.id, origin[x.id]);
      out.push(...merged);
    };
    const tplNodes = tpl
      ? flatten(tpl.nodes as NodeInput[], owner).map((n) => ({ ...n, parent: rebase(n.parent), owningThing: kind === "thing" ? owner : rebase(n.owningThing), fromTemplate: ref! }))
      : [];
    const own = (v: string) => v.replaceAll(THING_PLACEHOLDER, owner).replaceAll(SYSTEM_PLACEHOLDER, owner);
    const tplCriteria = (tpl?.criteria ?? []).map((c) => ({ ...c, id: own(c.id), ...(c.hooks && { hooks: c.hooks.map(own) }), ownerId: rebase(c.ownerId), subjectId: rebase(c.subjectId), fromTemplate: ref! }));
    const tplHooks = (tpl?.hooks ?? []).map((h) => ({ ...h, id: own(h.id), ...(h.criteria && { criteria: h.criteria.map(own) }), fromTemplate: ref! }));
    merge("node", tplNodes, instNodes.get(owner) ?? [], nodes);
    merge("criterion", tplCriteria, instCriteria.get(owner) ?? [], criteria);
    merge("hook", tplHooks, instHooks.get(owner) ?? [], hooks);
    return tpl;
  };
  resolve(system.template, "system", system.id, "system.yaml");
  const resolvedThings = things.map(({ thing, file }): schema.ResolvedThing => {
    const tpl = resolve(thing.templateRef, "thing", thing.id, file);
    return { ...thing, sections: thing.sections ?? tpl?.sections ?? [] };
  });

  const model = {
    revision: opts.revision,
    system,
    purposes,
    externals,
    claims,
    description,
    kits,
    things: resolvedThings,
    templates,
    nodes,
    requirements,
    criteria,
    hooks,
    journeys,
    evolutions,
    origin,
    warnings,
  };
  return { ...model, index: index(model) };
}
