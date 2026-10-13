import { parse as parseYaml } from "yaml";
import { files } from "./generated/files.ts";
import { ARTYFACT_GENOME, artyfactGenome, loadTemplate, type Template as MetaTemplate, type TemplateStore as MetaStore } from "@artyfact/ontology";

// "template.thing.cloudflare-worker-webapp@1" -> "thing/cloudflare-worker-webapp@1"
function templateDir(ref: string): string | undefined {
  const m = /^template\.(system|thing)\.([\w.-]+@[\w.-]+)$/.exec(ref);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** meta@1 templates (ontology engine form) carry `meta: 1`. */
const isMeta = (text: string): boolean => (parseYaml(text) as { meta?: unknown } | null)?.meta === 1;

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
