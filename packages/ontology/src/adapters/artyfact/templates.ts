import { parse as parseYaml } from "yaml";
import * as schema from "./schema.ts";

export type Files = Record<string, string>;

export const templateRef = (t: Pick<schema.Template, "id" | "version">): string => `${t.id}@${t.version}`;

/** "template.thing.x@1" -> "thing/x@1", the artyfact templates package layout. */
export function templateDir(ref: string): string | undefined {
  const m = /^template\.(system|thing)\.([\w.-]+@[\w.-]+)$/.exec(ref);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\//, "");

/** Reads one artyfact template from a templates directory map, folding in `criteria.yaml`, `source-map.defaults.yaml` and `scaffold.yaml`. */
export function readArtyfactTemplate(ref: string, files: Files): schema.Template | undefined {
  const dir = templateDir(ref);
  const byPath = new Map(Object.entries(files).map(([p, t]) => [norm(p), t]));
  const text = dir && byPath.get(`${dir}/template.yaml`);
  if (text === undefined || !dir) return undefined;
  const read = (name: string) => { const t = byPath.get(`${dir}/${name}`); return t === undefined ? undefined : parseYaml(t); };
  const raw = (parseYaml(text) ?? {}) as Record<string, unknown>;
  const criteria = read("criteria.yaml") as { criteria?: unknown[]; hooks?: unknown[] } | undefined;
  if (criteria) {
    raw.criteria = [...((raw.criteria as unknown[]) ?? []), ...(criteria.criteria ?? [])];
    raw.hooks = [...((raw.hooks as unknown[]) ?? []), ...(criteria.hooks ?? [])];
  }
  const sourceMap = read("source-map.defaults.yaml");
  if (sourceMap) raw.sourceMapDefaults = sourceMap;
  const scaffold = read("scaffold.yaml") as { repo?: string; path?: string } | undefined;
  if (scaffold) raw.scaffold = { repo: scaffold.repo, path: scaffold.path };
  const t = schema.Template.parse(raw);
  if (templateRef(t) !== ref) throw new Error(`template ${dir} declares ${templateRef(t)}, expected ${ref}`);
  return t;
}

export interface ArtyfactTemplateStore { get(ref: string): schema.Template | undefined }

export const artyfactTemplateStore = (files: Files): ArtyfactTemplateStore => {
  const cache = new Map<string, schema.Template | undefined>();
  return { get: (ref) => (cache.has(ref) ? cache.get(ref) : (cache.set(ref, readArtyfactTemplate(ref, files)), cache.get(ref))) };
};
