/**
 * The legacy (v1) shape of the bundled templates and the legacy-dialect rule packs, read straight from the bundle.
 * Only the v1 -> v2 converter consumes these files now; the tests keep them in step with the meta@1 templates until
 * the migration has run and they are deleted (docs/design/ontology.md §2a).
 */
import { parse as parseYaml } from "yaml";
import { schema } from "@artyfact/model";
import { files } from "../src/generated/files";

export interface RulePack { id: string; version: string; source: string }

const dirOf = (ref: string) => {
  const m = /^template\.(system|thing)\.([\w.-]+@[\w.-]+)$/.exec(ref);
  return m ? `${m[1]}/${m[2]}` : undefined;
};

/** `template.v1.yaml` with its sibling `criteria.yaml` and `scaffold.yaml` folded in; undefined for an unknown ref. */
export function v1Template(ref: string): schema.Template | undefined {
  const dir = dirOf(ref);
  const main = dir && files[`${dir}/template.v1.yaml`];
  if (!main) return undefined;
  const raw = (parseYaml(main) ?? {}) as Record<string, unknown>;
  const read = (name: string) => (files[`${dir}/${name}`] === undefined ? undefined : parseYaml(files[`${dir}/${name}`]));
  const criteria = read("criteria.yaml") as { criteria?: unknown[]; hooks?: unknown[] } | undefined;
  if (criteria) {
    raw.criteria = [...((raw.criteria as unknown[]) ?? []), ...(criteria.criteria ?? [])];
    raw.hooks = [...((raw.hooks as unknown[]) ?? []), ...(criteria.hooks ?? [])];
  }
  const scaffold = read("scaffold.yaml") as { repo?: string; path?: string } | undefined;
  if (scaffold) raw.scaffold = { repo: scaffold.repo, path: scaffold.path };
  return schema.Template.parse(raw);
}

/** Every bundled template ref with a v1 shape. */
export const v1TemplateRefs = (): string[] =>
  Object.keys(files).filter((f) => f.endsWith("/template.v1.yaml")).map((f) => {
    const [kind, nameVer] = f.split("/");
    return `template.${kind}.${nameVer}`;
  });

export const rulePacks: RulePack[] = Object.keys(files)
  .filter((f) => f.startsWith("rule-packs/") && f.endsWith(".dl"))
  .map((f) => {
    const [id, version] = f.slice("rule-packs/".length, -".dl".length).split("@");
    return { id: id!, version: version!, source: files[f]! };
  });

/** The bundled pack `id` (every pack is at version 1); throws on an unknown id. */
export function pack(id: string): RulePack {
  const found = rulePacks.find((p) => p.id === id);
  if (!found) throw new Error(`unknown rule pack ${id}`);
  return found;
}
