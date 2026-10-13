import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { readDir } from "../src/adapters/artyfact/node.ts";
import {
  applyOps, templateDir, GenomeTreeError, graphHash, mintId, parseTree, readTree, TreeOpError, type FileChange, type TreeOp,
} from "../src/index.ts";

/** The meta@1 `template.yaml` sources, as `@artyfact/templates`' `metaTemplates` serves them. */
const metaStore = (files: Record<string, string>) => ({
  get: (ref: string) => { const t = files[`${templateDir(ref)}/template.yaml`]; return t === undefined ? undefined : parseYaml(t); },
});
const templates = metaStore(readDir(join(__dirname, "../../templates")));
const KIT = readDir(join(__dirname, "fixtures/genome-v2/keep-in-touch"));
const kitTree = parseTree(KIT);
const apply = (files: Record<string, string>, changes: FileChange[]) => {
  const out = { ...files };
  for (const c of changes) if (c.content === null) delete out[c.path]; else out[c.path] = c.content;
  return out;
};
const none = { get: () => undefined };

const SMALL = {
  "node.yaml": "id: system.s\nkind: system\nfields: {name: S}\n",
  "thing.app/node.yaml": [
    "# The app Thing.",
    "id: thing.app",
    "kind: thing",
    "fields:",
    "  name: App # shown in the header",
    "  description: The app.",
    "links: [{rel: serves, to: P1}]",
    "",
  ].join("\n"),
  "thing.app/screen.home/node.yaml": [
    "id: screen.home",
    "kind: screen",
    "fields: {title: Home, description: Landing.}",
    "links:",
    "  - { rel: serves, to: ext.owner } # the owner only",
    "files: [src/home/**]",
    "criteria:",
    "  # Kept in sync with the spec.",
    "  - id: C.home.loads",
    "    claim: Home loads.",
    "    target: artifact",
    "    gates: [candidate]",
    "    hooks:",
    "      - {id: hook.home, assay: home, tier: execution, engine: vitest, triggers: [candidate]}",
    "  - id: C.home.fast",
    "    claim: Home is fast.",
    "    hooks: [hook.home]",
    "",
  ].join("\n"),
  "thing.app/screen.home/widget.a/node.yaml": "id: widget.a\nkind: component\n",
  "P1/node.yaml": "id: P1\nkind: purpose\nfields: {statement: Help.}\n",
  "evolutions/evolution.1.yaml": [
    "id: evolution.1", "title: First", "intent: Start", "state: proposed", "kind: genome-amendment",
    "affectedNodes: [screen.home]", "acceptanceCriteria: [C.home.loads]", "",
  ].join("\n"),
  "README.md": "# not a node\n",
  ".notes/node.yaml": "not: [valid",
  "docs/notes.md": "ignored",
};

describe("readTree", () => {
  it("projects nodes, containment, links, criteria, hooks and evolutions", () => {
    const g = readTree(SMALL, none);
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    expect(g.template).toBe("template.meta.artyfact-genome@1");
    expect(byId.get("thing.app")).toMatchObject({ kind: "thing", parent: "system.s", fields: { name: "App" } });
    expect(byId.get("widget.a")?.parent).toBe("screen.home");
    expect(byId.get("system.s")?.fields).toEqual({ name: "S", purposes: ["P1"] });
    expect(byId.get("C.home.loads")).toEqual({
      id: "C.home.loads", kind: "criterion",
      fields: { version: 1, claim: "Home loads.", ownerKind: "thing", subjectKind: "screen", targetKind: "artifact", severity: "hard", gates: ["candidate"], deferred: false, hooks: ["hook.home"] },
    });
    expect(byId.get("hook.home")?.fields).toMatchObject({ criteria: ["C.home.loads", "C.home.fast"], targetKind: "artifact", timeoutMs: 60000 });
    expect(g.links).toEqual(expect.arrayContaining([
      { from: "thing.app", rel: "serves", to: "P1", certainty: "declared" },
      { from: "C.home.loads", rel: "owner", to: "thing.app" },
      { from: "C.home.loads", rel: "subject", to: "screen.home" },
      { from: "evolution.1", rel: "affects", to: "screen.home" },
    ]));
    expect(byId.has("evolution.1")).toBe(true);
  });

  it("keeps files globs on the tree node, not in the graph", () => {
    expect(parseTree(SMALL).nodes.get("screen.home")?.file.files).toEqual(["src/home/**"]);
    expect(readTree(SMALL, none).nodes.find((n) => n.id === "screen.home")?.fields).toEqual({ title: "Home", description: "Landing." });
  });

  it("is deterministic: the same files in any order give the same graph", () => {
    const reversed = new Map(Object.entries(KIT).reverse());
    expect(readTree(reversed, templates)).toEqual(readTree(KIT, templates));
    expect(graphHash(readTree(reversed, templates))).toBe(graphHash(readTree(KIT, templates)));
  });

  const issues = (files: Record<string, string>, t = none) => {
    try { readTree(files, t); } catch (e) { if (e instanceof GenomeTreeError) return e.issues; throw e; }
    return [];
  };
  it("reports every structural error with its path", () => {
    expect(issues({ "a/node.yaml": "id: a\nkind: x\n" })).toContainEqual({ path: "node.yaml", message: "missing the root node.yaml" });
    expect(issues({ ...SMALL, "x/y/node.yaml": "id: y\nkind: k\n" })).toContainEqual({ path: "x/y/node.yaml", message: "no node.yaml in the enclosing directory x" });
    expect(issues({ ...SMALL, "-bad/node.yaml": "id: b\nkind: k\n" })).toContainEqual({ path: "-bad/node.yaml", message: 'directory name "-bad" is not a node slug' });
    expect(issues({ ...SMALL, "b/node.yaml": "id: b\nkind: k\ncolour: red\n" })[0]?.path).toBe("b/node.yaml");
    expect(issues({ ...SMALL, "b/node.yaml": "id: P1\nkind: k\n" })).toContainEqual({ path: "b/node.yaml", message: "duplicate id P1 (also in P1/node.yaml)" });
    expect(issues({ ...SMALL, "evolutions/node.yaml": "id: e\nkind: k\n" })).toContainEqual({ path: "evolutions/node.yaml", message: "evolutions/ holds only flat change records" });
    expect(issues({ ...SMALL, "b/node.yaml": "id: b\nkind: k\ncriteria: [{id: C.b, claim: x, hooks: [hook.nope]}]\n" }))
      .toContainEqual({ path: "b/node.yaml", message: "criterion C.b names hook hook.nope, which no criterion declares" });
    expect(issues({ ...SMALL, "node.yaml": "id: system.s\nkind: system\ntemplate: template.system.nope@1\n" }))
      .toContainEqual({ path: "node.yaml", message: "unknown template template.system.nope@1" });
    expect(issues({ ...SMALL, "b/node.yaml": "id: b\nkind: [unclosed\n" })[0]?.path).toBe("b/node.yaml");
  });
});

describe("applyOps", () => {
  it("round-trips: re-applying every node's own fields, criteria and links changes no file", () => {
    const ops: TreeOp[] = [];
    for (const n of kitTree.nodes.values()) {
      ops.push({ op: "update", node: n.id, fields: n.file.fields ?? {}, criteria: n.file.criteria ?? [] });
      for (const l of n.file.links ?? []) ops.push({ op: "link", node: n.id, link: l });
    }
    const r = applyOps(KIT, ops);
    expect(r.changes).toEqual([]);
    expect(applyOps(KIT, []).changes).toEqual([]);
    expect(readTree(apply(KIT, r.changes), templates)).toEqual(readTree(KIT, templates));
  });

  it("updates a field in place, keeping comments, key order and flow style", () => {
    const r = applyOps(SMALL, [{ op: "update", node: "thing.app", fields: { description: "The web app.", owner: "me", name: null } }]);
    expect(r.changes).toEqual([{ path: "thing.app/node.yaml", content: [
      "# The app Thing.",
      "id: thing.app",
      "kind: thing",
      "fields:",
      "  description: The web app.",
      "  owner: me",
      "links: [ { rel: serves, to: P1 } ]",
      "",
    ].join("\n") }]);
    expect(r.touched).toEqual(["thing.app"]);
    const home = applyOps(SMALL, [{ op: "update", node: "screen.home", fields: { title: "Start" } }]).changes[0]!.content!;
    expect(home).toContain("fields: { title: Start, description: Landing. }");
    expect(home).toContain("# the owner only");
    expect(home).toContain("# Kept in sync with the spec.");
  });

  it("upserts and removes criteria, keeping inline hooks and comments", () => {
    const r = applyOps(SMALL, [{
      op: "update", node: "screen.home", criteria: [
        { id: "C.home.loads", claim: "Home loads in every state.", target: "artifact", gates: ["candidate"], hooks: [{ id: "hook.home", assay: "home", tier: "execution", engine: "vitest", triggers: ["candidate"] }] },
        { id: "C.home.fast", remove: true },
        { id: "C.home.a11y", claim: "Home is accessible.", severity: "soft" },
      ],
    }]);
    const text = r.changes[0]!.content!;
    expect(text).toContain("# Kept in sync with the spec.");
    expect(text).toContain("claim: Home loads in every state.");
    expect(text).not.toContain("C.home.fast");
    const tree = parseTree(apply(SMALL, r.changes));
    expect(tree.nodes.get("screen.home")?.file.criteria?.map((c) => c.id)).toEqual(["C.home.loads", "C.home.a11y"]);
    expect(() => applyOps(SMALL, [{ op: "update", node: "screen.home", criteria: [{ id: "C.nope", remove: true }] }])).toThrow(TreeOpError);
    expect(() => applyOps(SMALL, [{ op: "update", node: "screen.home", criteria: [{ id: "C.home.loads", remove: true }] }]))
      .toThrow("thing.app/screen.home/node.yaml: criterion C.home.fast names hook hook.home, which no criterion declares");
  });

  it("adds a node directory under its parent, minting the id and the slug", () => {
    const r = applyOps(SMALL, [
      { op: "add", kind: "screen", parent: "thing.app", fields: { title: "Settings page" } },
      { op: "add", node: "ext.mail", kind: "external", fields: { name: "Mail" }, links: [{ rel: "serves", to: "P1" }] },
      { op: "link", node: "screen.Settings-page", link: { rel: "serves", to: "ext.mail" } },
    ]);
    expect(r.changes.map((c) => c.path)).toEqual(["ext.mail/node.yaml", "thing.app/screen.Settings-page/node.yaml"]);
    expect(r.changes[0]!.content).toBe("id: ext.mail\nkind: external\nfields:\n  name: Mail\nlinks:\n  - { rel: serves, to: P1 }\n");
    expect(r.touched).toEqual(["screen.Settings-page", "ext.mail"]);
    const g = readTree(apply(SMALL, r.changes), none);
    expect(g.nodes.find((n) => n.id === "screen.Settings-page")?.parent).toBe("thing.app");
    expect(g.links).toContainEqual({ from: "screen.Settings-page", rel: "serves", to: "ext.mail", certainty: "declared" });
    expect(mintId("screen", "Home", new Set(["screen.Home", "screen.Home-2"]))).toBe("screen.Home-3");
    expect(() => applyOps(SMALL, [{ op: "add", node: "P1", kind: "purpose" }])).toThrow(/node P1 already exists/);
    expect(() => applyOps(SMALL, [{ op: "add", node: "x", kind: "k", parent: "nope" }])).toThrow(/unknown parent nope/);
  });

  it("suffixes a slug that a sibling directory already uses, and never uses evolutions/ at the root", () => {
    const files = { ...SMALL, "thing.app/screen.x/node.yaml": "id: screen.other\nkind: screen\n" };
    expect(applyOps(files, [{ op: "add", node: "screen.x", kind: "screen", parent: "thing.app" }]).changes[0]!.path).toBe("thing.app/screen.x-2/node.yaml");
    expect(applyOps(SMALL, [{ op: "add", node: "evolutions", kind: "k" }]).changes[0]!.path).toBe("evolutions-2/node.yaml");
  });

  it("removes a node's whole subtree and nothing else", () => {
    const r = applyOps(KIT, [{ op: "remove", node: "section.ui" }]);
    const under = Object.keys(KIT).filter((p) => p.startsWith("thing.webapp/section.ui/"));
    expect(under.length).toBeGreaterThan(10);
    expect(r.changes).toEqual(under.sort().map((path) => ({ path, content: null })));
    expect(r.touched).toContain("section.ui");
    expect(r.touched).toContain("screen.people");
    expect(() => applyOps(KIT, [{ op: "remove", node: "system.keep-in-touch" }])).toThrow(/cannot remove the root/);
  });

  it("links once and unlinks, dropping an emptied links key", () => {
    const linked = applyOps(SMALL, [{ op: "link", node: "screen.home", link: { rel: "serves", to: "P1", certainty: "assumed" } }]);
    expect(linked.changes[0]!.content).toContain("  - { rel: serves, to: ext.owner } # the owner only\n  - { rel: serves, to: P1, certainty: assumed }\n");
    expect(applyOps(SMALL, [{ op: "link", node: "screen.home", link: { rel: "serves", to: "ext.owner" } }])).toEqual({ changes: [], touched: [] });
    const labelled = applyOps(SMALL, [{ op: "link", node: "P1", link: { rel: "references", to: "ext.owner", label: "who it is for", source: { doc: "spec", section: "2" } } }]);
    expect(labelled.changes[0]!.content).toContain("  - { rel: references, to: ext.owner, label: who it is for, source: { doc: spec, section: \"2\" } }\n");
    const unlinked = applyOps(SMALL, [{ op: "unlink", node: "thing.app", link: { rel: "serves", to: "P1" } }]);
    expect(unlinked.changes[0]!.content).not.toContain("links");
    expect(unlinked.touched).toEqual(["thing.app"]);
    const fresh = applyOps(SMALL, [{ op: "link", node: "P1", link: { rel: "beneficiary", to: "ext.owner" } }]);
    expect(fresh.changes[0]!.content).toBe("id: P1\nkind: purpose\nfields: { statement: Help. }\nlinks:\n  - { rel: beneficiary, to: ext.owner }\n");
  });

  it("refuses an edit that leaves an invalid node.yaml", () => {
    expect(() => applyOps(SMALL, [{ op: "update", node: "screen.home", criteria: [{ id: "bad", claim: "x" } as never] }])).toThrow(/criterion ids start with C\./);
    expect(() => applyOps(SMALL, [{ op: "update", node: "nope", fields: { a: 1 } }])).toThrow(/unknown node nope/);
  });
});
