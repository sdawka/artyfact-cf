import { parse as parseYaml } from "yaml";
import { schema, type TemplateStore } from "../src/index";

// Fixtures are bundled with Vite's import.meta.glob, so tests need no Node APIs.
const mini = import.meta.glob("./fixtures/mini/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
// The real Rule Packs, read from the repo (not via @artyfact/templates, which would make model ↔ templates cyclic).
const packFiles = import.meta.glob("../../templates/rule-packs/*.dl", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const factsDoc = Object.values(import.meta.glob("../../../docs/design/facts.md", { query: "?raw", import: "default", eager: true }))[0] as string;

/** The mini fixture as loadSystem input: repo-relative path → text. */
export function readTree(): Map<string, string> {
  return new Map(Object.entries(mini).map(([p, t]) => [p.replace("./fixtures/mini/", ""), t] as const).sort(([a], [b]) => (a < b ? -1 : 1)));
}

export const miniTemplateYaml = `
id: template.thing.mini-webapp
kind: thing
version: "1"
name: Mini webapp
sections: [section.ui, section.domain]
nodes:
  - { id: section.ui, kind: section, name: UI, parent: $thing, owningThing: $thing }
  - id: section.domain
    kind: section
    name: Domain
    parent: $thing
    owningThing: $thing
  - { id: component.AppShell, kind: component, name: App shell, parent: section.ui }
criteria:
  - id: C.app.exists
    title: Artifact exists
    claim: The artifact has the required files
    ownerKind: thing
    ownerId: $thing
    subjectKind: thing
    subjectId: $thing
    targetKind: artifact
    gates: [submission]
    hooks: [hook.app.exists]
hooks:
  - id: hook.app.exists
    assay: Required files present
    criteria: [C.app.exists]
    tier: basic
    engine: manifest
    targetKind: artifact
    triggers: [submission]
    binding: bound
`;

export function store(...yamls: string[]): TemplateStore {
  const all = new Map<string, schema.Template>();
  for (const y of yamls.length ? yamls : [miniTemplateYaml]) {
    const t = schema.Template.parse(parseYaml(y));
    all.set(`${t.id}@${t.version}`, t);
  }
  return { get: (ref) => all.get(ref) };
}

/** Replace `from` with `to` in one fixture file, asserting the edit applied. */
export function edit(files: Map<string, string>, path: string, from: string | RegExp, to: string): Map<string, string> {
  const before = files.get(path)!;
  const after = before.replace(from, to);
  if (after === before) throw new Error(`edit did not apply to ${path}`);
  return new Map(files).set(path, after);
}

export interface Pack { id: string; version: string; source: string }

/** All real packs, as `{id, version, source}` from `rule-packs/<id>@<version>.dl`. */
export const realPacks: Pack[] = Object.entries(packFiles).map(([path, source]) => {
  const [id, version] = path.split("/").pop()!.replace(/\.dl$/, "").split("@");
  return { id, version, source };
}).sort((a, b) => (a.id < b.id ? -1 : 1));

/** Same selection rule as @artyfact/templates packsFor(): exact id + version. */
export function packsFor(pins: { id: string; version: string }[]): Pack[] {
  return pins.map((p) => {
    const found = realPacks.find((r) => r.id === p.id && r.version === p.version);
    if (!found) throw new Error(`unknown rule pack ${p.id}@${p.version}`);
    return found;
  });
}

export { factsDoc };
