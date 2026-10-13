// Artyfact describes itself: the repo-root genome/ loads under its pinned templates and maps every source file.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import picomatch from "picomatch";
import { describe, expect, it } from "vitest";
import { evaluate, instantiateNodes, loadTemplate, parseTree, projectTree, type GenomeTree, type TreeNode } from "@artyfact/ontology";
import { loadMetaTemplate, metaTemplates } from "../src/index";
import { compose, GENERIC_THINGS, SYSTEM } from "./dev-platform";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const genomeDir = join(repo, "genome");

function genomeFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split("\\").join("/")] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
}

/** `.artyfactignore`: one pattern per line; a leading `/` anchors it at the repo root, otherwise it matches any path segment. */
function ignoreFilter(text: string): (path: string) => boolean {
  const pats = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => l.replace(/\/$/, ""));
  return (path) => pats.some((p) => (p.startsWith("/") ? path === p.slice(1) || path.startsWith(`${p.slice(1)}/`) : path.split("/").includes(p)));
}

/**
 * A node's effective globs (docs/design/ontology.md §3): its kind's `files`, its prefilled template node's `files`, the
 * template's root `files` for the node that instantiates it, and its own `files`, each prefixed with the nearest `root`.
 */
function effectiveGlobs(tree: GenomeTree): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const up = (n: TreeNode, pick: (t: TreeNode) => string | undefined): { at?: TreeNode; value?: string } => {
    for (let x: TreeNode | undefined = n; x; x = x.parent === undefined ? undefined : tree.nodes.get(x.parent)) {
      const v = pick(x);
      if (v !== undefined) return { at: x, value: v };
    }
    return {};
  };
  for (const n of tree.nodes.values()) {
    const root = up(n, (x) => x.file.root).value;
    const owner = up(n, (x) => x.file.template);
    const t = owner.value ? loadMetaTemplate(owner.value) : undefined;
    const slug = n.dir.split("/").pop() ?? "";
    const kindFiles = (t?.kinds[n.file.kind]?.files ?? []).map((g) => g.replaceAll("{id}", n.id).replaceAll("{slug}", slug));
    const prefilled = t && owner.at ? instantiateNodes(t, owner.at.id).find((p) => p.id === n.id)?.files ?? [] : [];
    const templateFiles = n.file.template ? t?.files ?? [] : [];
    const globs = [...kindFiles, ...prefilled, ...templateFiles, ...(n.file.files ?? [])];
    out.set(n.id, globs.map((g) => (root ? `${root}/${g}` : g)));
  }
  return out;
}

describe("the Artyfact self-Genome", () => {
  const tree = parseTree(genomeFiles(genomeDir));
  const graph = projectTree(tree, metaTemplates);
  const template = loadTemplate(compose([SYSTEM, ...GENERIC_THINGS]));
  const readiness = evaluate(template, { ...graph, template: template.ref });
  const things = graph.nodes.filter((n) => n.kind === "thing");

  it("is system.artyfact on the dev-platform template, with one Thing per app and package", () => {
    expect(tree.root).toBe("system.artyfact");
    expect(graph.template).toBe(SYSTEM);
    expect(things.map((n) => n.id).sort()).toEqual([
      "thing.ci", "thing.cli", "thing.effects", "thing.model", "thing.ontology", "thing.platform", "thing.rules", "thing.semantic", "thing.site", "thing.templates",
    ]);
    const pinned = (id: string) => graph.links.find((l) => l.from === id && l.rel === "pinned")?.to;
    expect(pinned("thing.platform")).toBe("template.thing.cloudflare-worker-service@1");
    expect(pinned("thing.ci")).toBe("template.thing.cloudflare-worker-service@1");
    expect(pinned("thing.site")).toBe("template.thing.static-site@1");
    expect(pinned("thing.cli")).toBe("template.thing.cli@1");
    for (const p of ["model", "ontology", "semantic", "rules", "templates", "effects"]) expect(pinned(`thing.${p}`)).toBe("template.thing.ts-library@1");
  });

  it("gives each Thing the root of its workspace and the sections its template instantiates", () => {
    for (const t of things) {
      const n = tree.nodes.get(t.id)!;
      const pkg = JSON.parse(readFileSync(join(repo, n.file.root!, "package.json"), "utf8")) as { name: string };
      expect(pkg.name, t.id).toMatch(/^@artyfact\//);
      const want = instantiateNodes(loadMetaTemplate(n.file.template!), t.id).filter((s) => s.kind === "section").map((s) => s.id).sort();
      expect(graph.nodes.filter((x) => x.kind === "section" && x.parent === t.id).map((x) => x.id).sort(), t.id).toEqual(want);
    }
  });

  it("links Things by dependsOn exactly as their package.json workspace dependencies", () => {
    const byPackage = new Map(things.map((t) => {
      const root = tree.nodes.get(t.id)!.file.root!;
      return [(JSON.parse(readFileSync(join(repo, root, "package.json"), "utf8")) as { name: string }).name, t.id] as const;
    }));
    for (const t of things) {
      const pkg = JSON.parse(readFileSync(join(repo, tree.nodes.get(t.id)!.file.root!, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
      const want = Object.keys(pkg.dependencies ?? {}).filter((d) => byPackage.has(d)).map((d) => byPackage.get(d)!).sort();
      const have = graph.links.filter((l) => l.from === t.id && l.rel === "dependsOn").map((l) => l.to).sort();
      expect(have, t.id).toEqual(want);
    }
  });

  it("evaluates with no hard findings under its pinned packs, and topology.services passes", () => {
    const hard = readiness.findings.filter((f) => f.level === "error" || f.level === "missing");
    expect(hard.map((f) => [f.rule, f.subject, f.message])).toEqual([]);
    expect(readiness.findings.filter((f) => f.rule.startsWith("topology.")).map((f) => [f.rule, f.subject])).toEqual([]);
    expect(readiness.packs.map((p) => p.id)).toContain("topology.services");
    expect(readiness.actionable).toBe(true);
  });

  it("names the platform's Durable Object, the CI Workflow and real routes and commands", () => {
    const field = (id: string, f: string) => graph.nodes.find((n) => n.id === id)?.fields[f];
    expect(field("durable-object.system-authority", "className")).toBe("SystemAuthority");
    expect(field("workflow.artyfact-ci", "name")).toBe("ArtyfactCI");
    const index = readFileSync(join(repo, "apps/platform/worker/index.ts"), "utf8");
    expect(index).toContain("SystemAuthority");
    const routes = graph.nodes.filter((n) => n.kind === "endpoint" && graph.nodes.find((p) => p.id === n.parent)?.parent === "thing.platform");
    const routeSrc = readdirSync(join(repo, "apps/platform/worker/routes")).map((f) => readFileSync(join(repo, "apps/platform/worker/routes", f), "utf8")).join("\n") + index;
    for (const e of routes) {
      const path = String(e.fields.route).split(" ")[1]!.replace(/^\/api/, "");
      const tail = path.split("/").filter((s) => s && !s.startsWith(":")).at(-1)!;
      expect(routeSrc, e.id).toContain(tail);
    }
    const main = readFileSync(join(repo, "packages/cli/src/main.ts"), "utf8");
    for (const c of graph.nodes.filter((n) => n.kind === "command" && n.parent === "thing.cli.commands")) expect(main, c.id).toContain(`case "${c.fields.name}"`);
  });

  it("maps every non-ignored source file under apps/ and packages/ to at least one node", () => {
    const ignored = ignoreFilter(readFileSync(join(repo, ".artyfactignore"), "utf8"));
    const files = execFileSync("git", ["ls-files", "apps", "packages"], { cwd: repo, encoding: "utf8" }).split("\n").filter((f) => f && !ignored(f));
    expect(files.length).toBeGreaterThan(300);
    const matchers = [...effectiveGlobs(tree).values()].flat().map((g) => picomatch(g, { dot: true }));
    const unmapped = files.filter((f) => !matchers.some((m) => m(f)));
    expect(unmapped).toEqual([]);
  });
});
