import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import * as schema from "./schema.ts";
import { artyfactTemplateStore, templateRef, type ArtyfactTemplateStore, type Files } from "./templates.ts";

export interface ParseIssue { path: PropertyKey[]; message: string }
export interface ModelWarning extends ParseIssue { file: string }

export class ArtyfactParseError extends Error {
  readonly file: string;
  readonly issues: ParseIssue[];
  constructor(file: string, issues: ParseIssue[]) {
    super(`${file}: ${issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; ")}`);
    this.name = "ArtyfactParseError";
    this.file = file;
    this.issues = issues;
  }
}

/** artyfact's `SystemModel` without its index: the YAML directory after template resolution. */
export interface ArtyfactModel {
  system: schema.SystemFile;
  purposes: schema.Purpose[];
  externals: schema.Externals[];
  claims: schema.TheoryClaim[];
  description?: schema.Description;
  kits: schema.KitsFile;
  things: schema.ResolvedThing[];
  templates: schema.Template[];
  nodes: schema.OntologyNode[];
  requirements: schema.Requirement[];
  criteria: schema.Criterion[];
  hooks: schema.AssayHook[];
  journeys: schema.Journey[];
  evolutions: schema.Evolution[];
  warnings: ModelWarning[];
}

export const THING_PLACEHOLDER = "$thing";
export const SYSTEM_PLACEHOLDER = "$system";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function droppedKeys(raw: unknown, parsed: unknown, path: PropertyKey[], out: ParseIssue[]) {
  if (Array.isArray(raw) && Array.isArray(parsed)) raw.forEach((x, i) => droppedKeys(x, parsed[i], [...path, i], out));
  else if (isObj(raw) && isObj(parsed)) {
    for (const k of Object.keys(raw)) {
      if (!(k in parsed)) out.push({ path: [...path, k], message: `unknown key "${k}" ignored` });
      else droppedKeys(raw[k], parsed[k], [...path, k], out);
    }
  }
}

function parseFile<S extends z.ZodType>(file: string, text: string, s: S, listKey: string | undefined, warnings: ModelWarning[]): z.infer<S> {
  let raw: unknown;
  try { raw = parseYaml(text); } catch (e) { throw new ArtyfactParseError(file, [{ path: [], message: (e as Error).message }]); }
  if (listKey && Array.isArray(raw)) raw = { [listKey]: raw };
  else if (listKey && raw && typeof raw === "object" && !(listKey in raw) && "id" in raw) raw = { [listKey]: [raw] };
  const r = s.safeParse(raw ?? {});
  if (!r.success) throw new ArtyfactParseError(file, r.error.issues.map((i) => ({ path: i.path, message: i.message })));
  const issues: ParseIssue[] = [];
  droppedKeys(raw ?? {}, r.data, [], issues);
  warnings.push(...issues.map((i) => ({ file, ...i })));
  return r.data;
}

type NodeInput = schema.OntologyNode & { children?: unknown[] };

/** Flattens nested `children`, defaulting `parent` to the enclosing node, or `topParent` at top level. */
export function flatten(nodes: NodeInput[], topParent: string | undefined): schema.OntologyNode[] {
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

export interface LoadOptions {
  /** The artyfact templates directory as a path -> text map (`thing/<name>@<v>/template.yaml`, ...), or a store. */
  templates?: Files | ArtyfactTemplateStore;
}

/** artyfact's `loadSystem`: the same layout, id uniqueness, template merging and placeholder rebasing. */
export function loadArtyfactModel(files: Files, opts: LoadOptions = {}): ArtyfactModel {
  const store: ArtyfactTemplateStore | undefined = opts.templates === undefined ? undefined
    : typeof opts.templates.get === "function" ? opts.templates as ArtyfactTemplateStore : artyfactTemplateStore(opts.templates as Files);
  const byPath = new Map(Object.entries(files).map(([p, t]) => [norm(p), t] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const get = (p: string) => byPath.get(p);
  const warnings: ModelWarning[] = [];
  const parse = <S extends z.ZodType>(file: string, text: string, s: S, listKey?: string) => parseFile(file, text, s, listKey, warnings);
  const systemText = get("system.yaml");
  if (systemText === undefined) throw new ArtyfactParseError("system.yaml", [{ path: [], message: "missing system.yaml" }]);
  const system = parse("system.yaml", systemText, schema.SystemFile);

  const origin: Record<string, string> = {};
  const seen = new Map<string, { kind: string; file: string }>();
  const claim = (kind: string, id: string, file: string) => {
    const prev = seen.get(id);
    if (prev !== undefined) throw new ArtyfactParseError(file, [{ path: [], message: `duplicate id ${id} (${kind}; also a ${prev.kind} in ${prev.file})` }]);
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
  const kits = parse("kits.yaml", get("kits.yaml") ?? "{}", schema.KitsFile);

  const things: { thing: schema.Thing; file: string; dir: string }[] = [];
  const instNodes = new Map<string, schema.OntologyNode[]>();
  const instCriteria = new Map<string, schema.Criterion[]>();
  const instHooks = new Map<string, schema.AssayHook[]>();
  const requirements: schema.Requirement[] = [];
  const journeys: schema.Journey[] = [];
  const evolutions: schema.Evolution[] = [];

  const readCriteria = (owner: string, file: string) => {
    const text = get(file);
    if (text === undefined) return;
    const c = parse(file, text, schema.CriteriaFile, "criteria");
    instCriteria.set(owner, c.criteria.map((x) => ((origin[x.id] = file), x)));
    instHooks.set(owner, c.hooks.map((x) => ((origin[x.id] = file), x)));
  };
  readCriteria(system.id, "criteria.yaml");

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
    readCriteria(thing.id, base + "criteria.yaml");
  }
  for (const [path, text] of byPath) {
    if (/^journeys\/[^/]+\.ya?ml$/.test(path)) journeys.push(...collect("journey", path, [parse(path, text, schema.Journey)]));
    else if (/^evolutions\/[^/]+\.ya?ml$/.test(path)) evolutions.push(...collect("evolution", path, [parse(path, text, schema.Evolution)]));
  }

  const templates: schema.Template[] = [];
  const nodes: schema.OntologyNode[] = [];
  const criteria: schema.Criterion[] = [];
  const hooks: schema.AssayHook[] = [];
  const resolve = (ref: string | null, kind: "system" | "thing", owner: string, file: string): schema.Template | undefined => {
    let tpl: schema.Template | undefined;
    if (ref) {
      tpl = store?.get(ref);
      const field = kind === "system" ? "template" : "templateRef";
      if (!tpl) throw new ArtyfactParseError(file, [{ path: [field], message: `unknown template ${ref}` }]);
      if (tpl.kind !== kind) throw new ArtyfactParseError(file, [{ path: [field], message: `template ${ref} is a ${tpl.kind} template, expected ${kind}` }]);
      if (!templates.some((t) => templateRef(t) === ref)) templates.push(tpl);
    }
    const merge = <T extends { id: string }>(collection: string, fromTpl: T[], inst: T[], out: T[]) => {
      const instById = new Map(inst.map((x) => [x.id, x]));
      const merged = [...fromTpl.map((t) => instById.get(t.id) ?? ((origin[t.id] = ref!), t)), ...inst.filter((x) => !fromTpl.some((t) => t.id === x.id))];
      for (const x of merged) claim(collection, x.id, origin[x.id]);
      out.push(...merged);
    };
    const p = tpl ? templateParts(tpl, kind, owner) : { nodes: [], criteria: [], hooks: [] };
    merge("node", p.nodes, instNodes.get(owner) ?? [], nodes);
    merge("criterion", p.criteria, instCriteria.get(owner) ?? [], criteria);
    merge("hook", p.hooks, instHooks.get(owner) ?? [], hooks);
    return tpl;
  };
  resolve(system.template, "system", system.id, "system.yaml");
  const resolvedThings = things.map(({ thing, file }): schema.ResolvedThing => {
    const tpl = resolve(thing.templateRef, "thing", thing.id, file);
    return { ...thing, sections: thing.sections ?? tpl?.sections ?? [] };
  });

  return { system, purposes, externals, claims, description, kits, things: resolvedThings, templates, nodes, requirements, criteria, hooks, journeys, evolutions, warnings };
}

/** A template's nodes, criteria and hooks for `owner`: stamped `fromTemplate`, placeholders rebased. */
export function templateParts(tpl: schema.Template, kind: "system" | "thing", owner: string) {
  const ref = templateRef(tpl);
  const rebase = <T extends string | undefined>(v: T): T => (v === THING_PLACEHOLDER || v === SYSTEM_PLACEHOLDER ? owner : v) as T;
  return {
    nodes: flatten(tpl.nodes as NodeInput[], owner)
      .map((n) => ({ ...n, parent: rebase(n.parent), owningThing: kind === "thing" ? owner : rebase(n.owningThing), fromTemplate: ref })),
    criteria: tpl.criteria.map((c) => ({ ...c, ownerId: rebase(c.ownerId), subjectId: rebase(c.subjectId), fromTemplate: ref })),
    hooks: tpl.hooks.map((h) => ({ ...h, fromTemplate: ref })),
  };
}
