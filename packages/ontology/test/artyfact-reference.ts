import { parse as parseYaml, stringify } from "yaml";
import { readDir } from "../src/adapters/artyfact/node.ts";
import { toFacts } from "./vendor/artyfact/facts.ts";
import { loadSystem, type SystemModel } from "./vendor/artyfact/load.ts";
import { Template } from "./vendor/artyfact/schema.ts";
import { validate } from "./vendor/artyfact/validate.ts";

export type Files = Record<string, string>;

export const systemFiles = (): Files => readDir(`${__dirname}/fixtures/artyfact/keep-in-touch-system`);
export const templateFiles = (): Files => readDir(`${__dirname}/fixtures/artyfact/templates`);

/** artyfact's own template bundle loader, against the fixture copies. */
export function referenceTemplates(files: Files) {
  return {
    get(ref: string) {
      const m = /^template\.(system|thing)\.([\w.-]+@[\w.-]+)$/.exec(ref);
      const dir = m && `${m[1]}/${m[2]}`;
      if (!dir || files[`${dir}/template.yaml`] === undefined) return undefined;
      const raw = parseYaml(files[`${dir}/template.yaml`]);
      const extra = files[`${dir}/criteria.yaml`] && parseYaml(files[`${dir}/criteria.yaml`]);
      if (extra) { raw.criteria = [...(raw.criteria ?? []), ...(extra.criteria ?? [])]; raw.hooks = [...(raw.hooks ?? []), ...(extra.hooks ?? [])]; }
      return Template.parse(raw);
    },
  };
}

export const referenceModel = (files: Files, tpls: Files): SystemModel => loadSystem(new Map(Object.entries(files)), { templates: referenceTemplates(tpls) });
export const referenceFacts = (m: SystemModel) => toFacts(m);
export const referenceFindings = (m: SystemModel, packs: { id: string; version: string; source: string }[]) => validate(m, packs).findings;

/** Returns a copy of `files` with `path` parsed, edited and re-serialised. */
export function edit(files: Files, path: string, f: (doc: any) => unknown): Files {
  const doc = files[path] === undefined ? undefined : parseYaml(files[path]);
  const out = f(doc);
  return { ...files, [path]: stringify(out === undefined ? doc : out) };
}
