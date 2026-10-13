import { parse as parseYaml } from "yaml";
import { files } from "./generated/files";
import { schema } from "@artyfact/model";
import { ARTYFACT_GENOME, artyfactGenome, loadTemplate, type Template as MetaTemplate, type TemplateStore as MetaStore } from "@artyfact/ontology";

const { Template } = schema;
export type Template = schema.Template;

export interface TemplateStore {
  get(ref: string): Template | undefined;
}

export interface RulePack {
  id: string;
  version: string;
  source: string;
}

// "template.thing.cloudflare-worker-webapp@1" -> "thing/cloudflare-worker-webapp@1"
function templateDir(ref: string): string | undefined {
  const m = /^template\.(system|thing)\.([\w.-]+@[\w.-]+)$/.exec(ref);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

const cache = new Map<string, Template>();

/** meta@1 templates (ontology engine form) carry `meta: 1`. */
const isMeta = (text: string): boolean => (parseYaml(text) as { meta?: unknown } | null)?.meta === 1;

// Legacy (v1) shape for today's consumers, until W4: `template.v1.yaml` plus sibling files (criteria.yaml,
// scaffold.yaml) folded in. The meta@1 `template.yaml` is read by `metaTemplates`.
function load(dir: string): Template | undefined {
  const main = files[`${dir}/template.v1.yaml`];
  if (main === undefined) return undefined;
  const raw = (parseYaml(main) ?? {}) as Record<string, unknown>;
  const read = (name: string) => (files[`${dir}/${name}`] === undefined ? undefined : parseYaml(files[`${dir}/${name}`]));
  const criteria = read("criteria.yaml") as { criteria?: unknown[]; hooks?: unknown[] } | undefined;
  if (criteria) {
    raw.criteria = [...((raw.criteria as unknown[]) ?? []), ...(criteria.criteria ?? [])];
    raw.hooks = [...((raw.hooks as unknown[]) ?? []), ...(criteria.hooks ?? [])];
  }
  const scaffold = read("scaffold.yaml") as { repo?: string; path?: string } | undefined;
  if (scaffold) raw.scaffold = { repo: scaffold.repo, path: scaffold.path };
  const t = Template.parse(raw);
  const actual = `${t.id}@${t.version}`;
  const expected = `template.${dir.replace("/", ".")}`;
  if (actual !== expected) throw new Error(`template ${dir} declares ${actual}, expected ${expected}`);
  return t;
}

export const templates: TemplateStore = {
  get(ref) {
    const hit = cache.get(ref);
    if (hit) return hit;
    const dir = templateDir(ref);
    const t = dir ? load(dir) : undefined;
    if (t) cache.set(ref, t);
    return t;
  },
};

export type { MetaTemplate };

/** The meta@1 sources: each bundled `template.yaml`, plus the engine's `template.meta.artyfact-genome@1` they extend. */
export const metaTemplates: MetaStore = {
  get(ref) {
    if (ref === ARTYFACT_GENOME) return artyfactGenome;
    const dir = templateDir(ref);
    const text = dir ? files[`${dir}/template.yaml`] : undefined;
    return text === undefined ? undefined : parseYaml(text);
  },
};

const metaCache = new Map<string, MetaTemplate>();

/** A bundled template as the engine sees it: meta@1 parsed and merged over its `extends` chain. Throws on an unknown ref. */
export function loadMetaTemplate(ref: string): MetaTemplate {
  const hit = metaCache.get(ref);
  if (hit) return hit;
  const raw = metaTemplates.get(ref);
  if (raw === undefined) throw new Error(`unknown template ${ref}`);
  const t = loadTemplate(raw, metaTemplates);
  metaCache.set(ref, t);
  return t;
}

/** Raw text of a bundled template file, e.g. `templateFile("template.thing.cloudflare-worker-webapp@1", "scaffold.yaml")`. */
export function templateFile(ref: string, name: string): string | undefined {
  const dir = templateDir(ref);
  return dir ? files[`${dir}/${name}`] : undefined;
}

/** Every bundled v1 template ref, e.g. "template.thing.vue-webapp@1". */
export function templateRefs(): string[] {
  return Object.keys(files)
    .filter((f) => f.endsWith("/template.v1.yaml") || (f.endsWith("/template.yaml") && !isMeta(files[f])))
    .map((f) => {
      const [kind, nameVer] = f.split("/");
      return `template.${kind}.${nameVer}`;
    });
}

/** Every bundled meta@1 template ref, e.g. "template.thing.cli@1". */
export function metaTemplateRefs(): string[] {
  return Object.keys(files)
    .filter((f) => f.endsWith("/template.yaml") && isMeta(files[f]))
    .map((f) => {
      const [kind, nameVer] = f.split("/");
      return `template.${kind}.${nameVer}`;
    });
}

/** The parsed meta@1 source of a bundled template, for the engine's `loadTemplate`; undefined for unknown or v1 refs. */
export function metaTemplateSource(ref: string): Record<string, unknown> | undefined {
  const dir = templateDir(ref);
  const text = dir ? files[`${dir}/template.yaml`] : undefined;
  return text !== undefined && isMeta(text) ? (parseYaml(text) as Record<string, unknown>) : undefined;
}

export const rulePacks: RulePack[] = Object.keys(files)
  .filter((f) => f.startsWith("rule-packs/") && f.endsWith(".dl"))
  .map((f) => {
    const [id, version] = f.slice("rule-packs/".length, -".dl".length).split("@");
    return { id, version, source: files[f] };
  });

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Look up a pack; throws on unknown id/version. Version defaults to the highest bundled. */
export function pack(id: string, version?: string): RulePack {
  const candidates = rulePacks.filter((p) => p.id === id && (version === undefined || p.version === version));
  const found = candidates.sort((a, b) => compareVersions(b.version, a.version))[0];
  if (!found) throw new Error(`unknown rule pack ${id}${version ? `@${version}` : ""}`);
  return found;
}

export function packsFor(kits: { id: string; version: string }[]): RulePack[] {
  return kits.map((k) => pack(k.id, k.version));
}
