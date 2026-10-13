import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  checkTemplateForm, checkViewHints, isLegacyGenome, isNodeSlug, loadTemplate, memoryStore, NodeFileSchema, parseNodeFile, resolveKindView, slugOf,
  type TemplateInput,
} from "../src/index.ts";

const SCREEN = `
id: screen.people
kind: screen
fields: {title: People, description: Lists the owner's contacts.}
links: [{rel: serves, to: purpose.audience, certainty: declared}]
files: [src/ui/people/**]
criteria:
  - id: C.webapp.screen.people
    claim: The People screen lists only the owner's contacts.
    severity: hard
    target: artifact
    gates: [candidate, promotion]
    hooks:
      - {id: hook.webapp.screen.people, assay: people fixture, tier: execution, engine: vitest, triggers: [candidate]}
  - id: C.webapp.screen.people.empty
    claim: An owner with no contacts sees an empty state.
    hooks: [hook.webapp.screen.people]
`;

describe("genome v2 node.yaml", () => {
  it("parses the node shape without adding keys", () => {
    const raw = parseYaml(SCREEN);
    const n = parseNodeFile(raw);
    expect(n).toEqual(raw);
    expect(n.criteria?.[1]?.hooks).toEqual(["hook.webapp.screen.people"]);
  });

  it("parses a Thing with its template and root", () => {
    expect(parseNodeFile({ id: "thing.webapp", kind: "thing", template: "template.thing.cloudflare-worker-webapp@1", root: "apps/web" }).root).toBe("apps/web");
  });

  it.each([
    ["an unknown key", { id: "a", kind: "k", parent: "b" }],
    ["a criterion id outside C.", { id: "a", kind: "k", criteria: [{ id: "x", claim: "c" }] }],
    ["an unknown severity", { id: "a", kind: "k", criteria: [{ id: "C.a", claim: "c", severity: "gate" }] }],
    ["an escaping files glob", { id: "a", kind: "k", files: ["../x/**"] }],
    ["an absolute root", { id: "a", kind: "k", root: "/apps/web" }],
    ["a template ref in another form", { id: "a", kind: "k", template: "thing/x@1" }],
    ["an unknown certainty", { id: "a", kind: "k", links: [{ rel: "r", to: "b", certainty: "maybe" }] }],
  ])("rejects %s", (_name, raw) => {
    expect(NodeFileSchema.safeParse(raw).success).toBe(false);
  });

  it("recognises a legacy v1 tree by its root file only", () => {
    expect(isLegacyGenome(["./system.yaml", "things/webapp/thing.yaml"])).toBe(true);
    expect(isLegacyGenome(["node.yaml", "thing.webapp/node.yaml", "evolutions/evolution.1.yaml"])).toBe(false);
    expect(isLegacyGenome(["node.yaml", "system.yaml"])).toBe(false);
    expect(isLegacyGenome(["things/webapp/system.yaml"])).toBe(false);
  });

  it("slugs ids into directory names", () => {
    expect(slugOf("screen.people")).toBe("screen.people");
    expect(slugOf("J.contacts/step 1")).toBe("J.contacts-step-1");
    expect(slugOf(".hidden")).toBe("hidden");
    expect(slugOf("///")).toBe("node");
    expect(isNodeSlug("-x")).toBe(false);
  });
});

const base: TemplateInput = {
  id: "template.test.base", version: 1, meta: 1,
  kinds: {
    system: { fields: [{ name: "title", type: "string" }], view: { glyph: "◎", colour: "slate", layer: "whole" } },
    screen: {
      parents: ["system"], fields: [{ name: "title", type: "string" }, { name: "route", type: "string" }, { name: "notes", type: "string" }],
      view: { label: "Screen", colour: "blue", layer: "ui", fields: ["route"] }, files: ["src/ui/{slug}/**"],
    },
    durableObject: { parents: ["system"] },
  },
  view: { layers: [{ id: "whole", label: "System" }, { id: "ui", label: "Interface" }] },
  files: ["package.json"],
};
const child: TemplateInput = {
  id: "template.test.child", version: 1, meta: 1, extends: "template.test.base@1",
  kinds: { screen: { parents: ["system"], fields: [{ name: "title", type: "string" }], view: { glyph: "▭" } } },
};

describe("view hints and files on templates", () => {
  it("are meta@1 well formed and resolve with defaults", () => {
    const t = loadTemplate(base);
    expect(checkTemplateForm(t).valid).toBe(true);
    expect(checkViewHints(t)).toEqual([]);
    expect(resolveKindView(t, "screen")).toEqual({
      kind: "screen", label: "Screen", plural: "Screens", glyph: "•", colour: "blue", layer: "ui", fields: ["route", "title", "notes"], summary: "description",
    });
    expect(resolveKindView(t, "durableObject")).toMatchObject({ label: "Durable object", plural: "Durable objects", colour: "neutral" });
    expect(resolveKindView(t, "durableObject").layer).toBeUndefined();
    expect(t.kinds.screen?.files).toEqual(["src/ui/{slug}/**"]);
    expect(t.files).toEqual(["package.json"]);
  });

  it("merge the kind view key by key over extends; the nearest kind declaration keeps its own files", () => {
    const t = loadTemplate(child, memoryStore([base]));
    expect(t.kinds.screen?.view).toEqual({ label: "Screen", colour: "blue", layer: "ui", fields: ["route"], glyph: "▭" });
    expect(t.kinds.screen?.files).toBeUndefined();
    expect(t.view?.layers?.map((l) => l.id)).toEqual(["whole", "ui"]);
    expect(t.files).toEqual(["package.json"]);
    // The child's screen no longer declares `route`, so the inherited Inspector order names an undeclared field.
    expect(checkViewHints(t)).toEqual([{ kind: "screen", message: "view names field route, which screen does not declare" }]);
  });

  it("report undeclared layers and duplicate layer ids", () => {
    const t = loadTemplate({ ...base, view: { layers: [{ id: "ui", label: "A" }, { id: "ui", label: "B" }] } });
    expect(checkViewHints(t).map((p) => p.message)).toEqual(["layer ui is declared twice", "layer whole is not declared in view.layers"]);
  });

  it("leave the template hash alone when absent", () => {
    const { view: _v, files: _f, ...plain } = base;
    const kinds = Object.fromEntries(Object.entries(plain.kinds!).map(([k, { view: _kv, files: _kf, ...rest }]) => [k, rest]));
    expect(loadTemplate({ ...plain, kinds }).hash).not.toBe(loadTemplate(base).hash);
    expect(Object.keys(loadTemplate({ ...plain, kinds }))).not.toContain("view");
    expect(Object.keys(loadTemplate({ ...plain, kinds }))).not.toContain("files");
  });
});
