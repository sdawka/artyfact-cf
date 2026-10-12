import { parse as parseYaml } from "yaml";
import { schema, type TemplateStore } from "../src/index";

// Fixtures are bundled with Vite's import.meta.glob, so tests need no Node APIs.
const mini = import.meta.glob("./fixtures/mini/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const packSource = Object.values(import.meta.glob("./fixtures/test-pack.dl", { query: "?raw", import: "default", eager: true }))[0] as string;

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

export const pack = { id: "test.pack", version: "1", source: packSource };
