import { parse as parseYaml } from "yaml";
import { ARTYFACT_GENOME, artyfactGenome } from "@artyfact/ontology";
import { loadGenome, type SystemModel, type TemplateStore } from "../src/index";

// Fixtures are bundled with Vite's import.meta.glob, so tests need no Node APIs.
const mini = import.meta.glob("./fixtures/mini/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
// The real templates' rule packs, read from the repo (not via @artyfact/templates, which depends on this package).
const bundled = import.meta.glob("../../templates/*/*/template.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const source = (dir: string) => parseYaml(bundled[`../../templates/${dir}/template.yaml`]!) as { rules: unknown[]; questions?: unknown[] };

/** The mini fixture (a v2 node tree): repo-relative path → text. */
export function readTree(): Map<string, string> {
  return new Map(Object.entries(mini).map(([p, t]) => [p.replace("./fixtures/mini/", ""), t] as const).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export const SYSTEM_TEMPLATE = "template.system.mini@1";
export const THING_TEMPLATE = "template.thing.mini-webapp@1";

const social = source("system/social-networking.cloudflare@1");
const webapp = source("thing/cloudflare-worker-webapp@1");

/** The mini System template: the artyfact base plus the System packs of `social-networking.cloudflare@1`. */
export const miniSystemTemplate = {
  id: "template.system.mini", version: 1, meta: 1, extends: ARTYFACT_GENOME,
  rules: social.rules, questions: social.questions ?? [],
  nodes: [{ id: SYSTEM_TEMPLATE, kind: "template", fields: { kind: "system", version: "1", name: "Mini" } }],
};

/** The mini Thing template: the artyfact base plus the Thing packs of `cloudflare-worker-webapp@1`. */
export const miniThingTemplate = {
  id: "template.thing.mini-webapp", version: 1, meta: 1, extends: ARTYFACT_GENOME, rules: webapp.rules,
  nodes: [{
    id: THING_TEMPLATE, kind: "template",
    fields: { kind: "thing", version: "1", name: "Mini webapp", sections: ["section.ui", "section.domain"], criteria: ["C.app.exists"], hooks: ["hook.app.exists"] },
  }],
};

/** meta@1 sources by ref: the base, the two mini templates and any `extra`. */
export function store(...extra: { id: string; version: number }[]): TemplateStore {
  const all = new Map<string, unknown>([[ARTYFACT_GENOME, artyfactGenome], [SYSTEM_TEMPLATE, miniSystemTemplate], [THING_TEMPLATE, miniThingTemplate]]);
  for (const t of extra) all.set(`${t.id}@${t.version}`, t);
  return { get: (ref) => all.get(ref) };
}

export const load = (files: Map<string, string> = readTree(), templates = store()): SystemModel => loadGenome(files, { templates });

/** The path of the `node.yaml` that declares node `id`. */
export function pathOf(files: Map<string, string>, id: string): string {
  const hit = [...files].find(([p, t]) => p.endsWith("node.yaml") && t.startsWith(`id: ${id}\n`));
  if (!hit) throw new Error(`no node.yaml declares ${id}`);
  return hit[0];
}

/** Replace `from` with `to` in one fixture file, asserting the edit applied. */
export function edit(files: Map<string, string>, path: string, from: string | RegExp, to: string): Map<string, string> {
  const before = files.get(path)!;
  const after = before.replace(from, to);
  if (after === before) throw new Error(`edit did not apply to ${path}`);
  return new Map(files).set(path, after);
}
