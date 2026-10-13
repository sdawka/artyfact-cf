import { hashOf } from "../canon.ts";
import { TemplateSourceSchema, type Check, type DefectsConfig, type Kind, type RootCriteria, type TemplateNode, type TemplateSource } from "./schema.ts";

export interface TemplateStore { get(ref: string): unknown }

export interface Template extends Omit<TemplateSource, "extends" | "defects" | "rootCriteria" | "rootChecks"> {
  /** Merged root checks; absent when no template in the chain declares any, so hashes are unchanged. */
  rootChecks?: Check[];
  /** Merged root criteria; absent when no template in the chain declares any, so hashes are unchanged. */
  rootCriteria?: RootCriteria;
  /** Merged `defects` overrides; absent when no template in the chain declares any, so hashes are unchanged. */
  defects?: DefectsConfig;
  ref: string;
  extends?: string;
  /** Refs that resolved, self first. */
  lineage: string[];
  /** Every `extends` edge walked, including unresolved targets and the edge that closes a cycle. */
  edges: [string, string][];
  hash: string;
}

export const refOf = (s: { id: string; version: number }): string => `${s.id}@${s.version}`;

export function memoryStore(sources: unknown[]): TemplateStore {
  const byRef = new Map(sources.map((s) => { const t = TemplateSourceSchema.parse(s); return [refOf(t), t] as const; }));
  return { get: (ref) => byRef.get(ref) };
}

export const emptyStore: TemplateStore = { get: () => undefined };

/** Follows `extends` from `ref` through `store`; stops at an unresolved target or the edge that closes a cycle. */
export function resolveLineage(ref: string, parent: string | undefined, store: TemplateStore) {
  const ancestors: TemplateSource[] = [];
  const edges: [string, string][] = [];
  const seen = new Set([ref]);
  for (let from = ref, to = parent; to !== undefined;) {
    edges.push([from, to]);
    if (seen.has(to)) break;
    const raw = store.get(to);
    if (raw === undefined) break;
    const next = TemplateSourceSchema.parse(raw);
    if (refOf(next) !== to) throw new Error(`store returned ${refOf(next)} for ${to}`);
    seen.add(to);
    ancestors.push(next);
    from = to;
    to = next.extends;
  }
  return { ancestors, edges };
}

const mergeById = <T extends { id: string }>(lists: T[][]): T[] => {
  const out = new Map<string, T>();
  for (const l of lists) for (const x of l) { out.delete(x.id); out.set(x.id, x); }
  return [...out.values()];
};

/** The nearest `textDefaults` in the chain wins wholesale; absent everywhere, the key is left out so hashes are unchanged. */
const textDefaultsOf = (chain: TemplateSource[]) => {
  const t = chain.find((s) => s.textDefaults !== undefined)?.textDefaults;
  return t === undefined ? {} : { textDefaults: t };
};

/** `disable` is the union over the chain; for `levels` the nearest template wins per defect id. */
const defectsOf = (chain: TemplateSource[]): { defects?: DefectsConfig } => {
  const top = [...chain].reverse();
  const disable = [...new Set(top.flatMap((s) => s.defects?.disable ?? []))].sort();
  const levels: DefectsConfig["levels"] = Object.assign({}, ...top.map((s) => s.defects?.levels ?? {}));
  return disable.length || Object.keys(levels).length ? { defects: { disable, levels } } : {};
};

/**
 * The nearest declaration of a kind wins, except `criteria` and `view`, which merge key by key over every template in
 * the chain that declares the kind (the nearer one wins per key). A kind no template gives criteria (or a view) keeps
 * no `criteria` (or `view`) key.
 */
const kindsOf = (top: TemplateSource[]): Record<string, Kind> => {
  const kinds: Record<string, Kind> = Object.assign({}, ...top.map((s) => s.kinds));
  return Object.fromEntries(Object.entries(kinds).map(([k, kind]) => {
    const all = top.map((s) => s.kinds[k]?.criteria).filter((c) => c !== undefined);
    const checks = top.map((s) => s.kinds[k]?.checks).filter((c) => c !== undefined);
    const views = top.map((s) => s.kinds[k]?.view).filter((v) => v !== undefined);
    const { checks: _own, view: _view, ...rest } = kind;
    return [k, {
      ...rest,
      ...(all.length && { criteria: Object.assign({}, ...all) }),
      ...(checks.length && { checks: mergeChecks(checks) }),
      ...(views.length && { view: Object.assign({}, ...views) }),
    }];
  }));
};

/**
 * Checks merge by id over the chain, the nearer template winning; duplicates within one template are kept so
 * meta@1 can report them (`check.idDuplicate`).
 */
export const mergeChecks = (lists: Check[][]): Check[] => {
  let out: Check[] = [];
  for (const l of lists) { const ids = new Set(l.map((c) => c.id)); out = [...out.filter((c) => !ids.has(c.id)), ...l]; }
  return out;
};

const rootChecksOf = (top: TemplateSource[]): { rootChecks?: Check[] } => {
  const all = top.map((s) => s.rootChecks).filter((c) => c !== undefined);
  return all.length ? { rootChecks: mergeChecks(all) } : {};
};

/** `view` and `files` at the template root: the nearest template that declares one wins; absent everywhere, left out. */
const nearestOf = <K extends "view" | "files">(chain: TemplateSource[], key: K): Partial<Pick<TemplateSource, K>> => {
  const v = chain.find((s) => s[key] !== undefined)?.[key];
  return v === undefined ? {} : ({ [key]: v } as Partial<Pick<TemplateSource, K>>);
};

/** Root criteria merge key by key, the nearest template winning; absent everywhere, the key is left out. */
const rootCriteriaOf = (top: TemplateSource[]): { rootCriteria?: RootCriteria } => {
  const all = top.map((s) => s.rootCriteria).filter((c) => c !== undefined);
  return all.length ? { rootCriteria: Object.assign({}, ...all) } : {};
};

function merge(chain: TemplateSource[]): Omit<TemplateSource, "id" | "version" | "meta" | "extends" | "defects" | "rootCriteria" | "rootChecks"> & { defects?: DefectsConfig; rootCriteria?: RootCriteria; rootChecks?: Check[] } {
  const top = [...chain].reverse();
  const c = top.map((s) => s.constraints);
  return {
    kinds: kindsOf(top),
    relations: Object.assign({}, ...top.map((s) => s.relations)),
    constraints: {
      forbiddenCycles: mergeById(c.map((x) => x.forbiddenCycles)),
      incompatible: mergeById(c.map((x) => x.incompatible)),
      exclusive: mergeById(c.map((x) => x.exclusive)),
      exactlyOne: mergeById(c.map((x) => x.exactlyOne)),
      complete: mergeById(c.map((x) => x.complete)),
    },
    criteria: mergeById(top.map((s) => s.criteria)),
    rules: mergeById(top.map((s) => s.rules)),
    questions: mergeById(top.map((s) => s.questions)),
    nodes: mergeById(top.map((s) => s.nodes)),
    ...textDefaultsOf(chain),
    ...defectsOf(chain),
    ...rootCriteriaOf(top),
    ...rootChecksOf(top),
    ...nearestOf(chain, "view"),
    ...nearestOf(chain, "files"),
  };
}

/** Parses a template against meta@1 and resolves `extends` through `store`; child declarations win by key or id. */
export function loadTemplate(raw: unknown, store: TemplateStore = emptyStore): Template {
  const self = TemplateSourceSchema.parse(raw);
  const { ancestors, edges } = resolveLineage(refOf(self), self.extends, store);
  const chain = [self, ...ancestors];
  const body = {
    ref: refOf(self), id: self.id, version: self.version, meta: self.meta,
    ...(self.extends !== undefined && { extends: self.extends }),
    lineage: chain.map(refOf), edges, ...merge(chain),
  };
  return { ...body, hash: hashOf(hashed(body)) };
}

/**
 * The form a template is hashed in: a `next` entry without `minStatus` hashes as its effective value, `review` on a
 * navigation question (`choicesFrom`) and `confident` otherwise (the rule of `minStatusOf` in the funnel). Templates
 * that do not set it on ordinary questions keep the hash they had when meta@1 filled in `confident`, and two templates
 * that behave differently never share a hash.
 */
const hashed = <T extends { questions?: Template["questions"] }>(t: T): T =>
  !t.questions?.some((q) => q.next?.some((n) => n.minStatus === undefined)) ? t
    : {
      ...t,
      questions: t.questions.map((q) => (q.next
        ? { ...q, next: q.next.map((n) => ({ ...n, minStatus: n.minStatus ?? (q.choicesFrom ? "review" : "confident") })) }
        : q)),
    };

export const templateHash = (t: Omit<Template, "hash"> & { hash?: string }): string => hashOf(hashed({ ...t, hash: undefined }));

const SELF = /\$self/g;
const subst = (v: unknown, self: string): unknown =>
  typeof v === "string" ? v.replace(SELF, self)
    : Array.isArray(v) ? v.map((x) => subst(x, self))
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, subst(x, self)]))
    : v;

/**
 * The template's prefilled nodes with `$self` replaced by `self`, in ids, fields and links. The template's own `template`
 * node is shared by every node that uses it, so it keeps `$self` (its `criteria` and `hooks` lists are patterns the
 * projection resolves per Thing).
 */
export const instantiateNodes = (t: Template, self: string): TemplateNode[] =>
  t.nodes.map((n) => (n.kind === "template" ? n : subst(n, self) as TemplateNode));
