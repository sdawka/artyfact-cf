import { parse as parseYaml } from "yaml";
import { files } from "./generated/files";
import { Template } from "./schema";

export type { Template } from "./schema";

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

// Sibling files (criteria.yaml, source-map.defaults.yaml, scaffold.yaml) are folded into the template.
function load(dir: string): Template | undefined {
  const main = files[`${dir}/template.yaml`];
  if (main === undefined) return undefined;
  const raw = (parseYaml(main) ?? {}) as Record<string, unknown>;
  const read = (name: string) => (files[`${dir}/${name}`] === undefined ? undefined : parseYaml(files[`${dir}/${name}`]));
  const criteria = read("criteria.yaml") as { criteria?: unknown[]; hooks?: unknown[] } | undefined;
  if (criteria) {
    raw.criteria = [...((raw.criteria as unknown[]) ?? []), ...(criteria.criteria ?? [])];
    raw.hooks = [...((raw.hooks as unknown[]) ?? []), ...(criteria.hooks ?? [])];
  }
  const sourceMap = read("source-map.defaults.yaml");
  if (sourceMap) raw.sourceMapDefaults = sourceMap;
  const scaffold = read("scaffold.yaml") as { repo?: string; path?: string } | undefined;
  if (scaffold) raw.scaffold = { repo: scaffold.repo, path: scaffold.path };
  return Template.parse(raw);
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

/** Raw text of a bundled template file, e.g. `templateFile("template.thing.cloudflare-worker-webapp@1", "scaffold.yaml")`. */
export function templateFile(ref: string, name: string): string | undefined {
  const dir = templateDir(ref);
  return dir ? files[`${dir}/${name}`] : undefined;
}

/** Every bundled template ref, e.g. "template.thing.vue-webapp@1". */
export function templateRefs(): string[] {
  return Object.keys(files)
    .filter((f) => f.endsWith("/template.yaml"))
    .map((f) => {
      const [kind, nameVer] = f.split("/");
      return `template.${kind}.${nameVer}`;
    });
}

export const rulePacks: RulePack[] = Object.keys(files)
  .filter((f) => f.startsWith("rule-packs/") && f.endsWith(".dl"))
  .map((f) => {
    const [id, version] = f.slice("rule-packs/".length, -".dl".length).split("@");
    return { id, version, source: files[f] };
  });

/** Look up a pack; throws on unknown id/version. Version defaults to the highest bundled. */
export function pack(id: string, version?: string): RulePack {
  const candidates = rulePacks.filter((p) => p.id === id && (version === undefined || p.version === version));
  const found = candidates.sort((a, b) => Number(b.version) - Number(a.version))[0];
  if (!found) throw new Error(`unknown rule pack ${id}${version ? `@${version}` : ""}`);
  return found;
}

export function packsFor(kits: { id: string; version: string }[]): RulePack[] {
  return kits.map((k) => pack(k.id, k.version));
}
