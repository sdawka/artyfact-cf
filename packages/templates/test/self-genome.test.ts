// Artyfact describes itself: the repo-root genome/ loads under its pinned templates and maps every source file.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import picomatch from "picomatch";
import { describe, expect, it } from "vitest";
import { instantiateNodes, parseTree, type GenomeTree, type TreeNode } from "@artyfact/ontology";
import { loadGenome, validate } from "@artyfact/model";
import { loadMetaTemplate, metaTemplates } from "../src/index";
import { SYSTEM } from "./dev-platform";

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

/**
 * `METHOD /api/path` for every route the platform Worker registers: the Hono `.get/.post/...` calls in
 * `worker/routes/*.ts` (mounted under /api), and `/api/health` in `worker/index.ts`. The realization routes are mounted
 * under three prefixes (`routes/realizations.ts`); the Genome models them once, under `/api/systems/:id/realizations/:rid`.
 */
function platformRoutes(): Set<string> {
  const worker = join(repo, "apps/platform/worker");
  const out = new Set<string>();
  for (const f of readdirSync(join(worker, "routes"))) {
    const src = readFileSync(join(worker, "routes", f), "utf8");
    if (f === "lifecycle.ts") {
      const constants: Record<string, string> = {};
      const expand = (text: string) => text.replace(/\$\{(\w+)\}/g, (match, name: string) => constants[name] ?? match);
      for (const match of src.matchAll(/(?:const\s+|,)(prefix|plan|task)\s*=\s*(['"`])([^'"`]+)\2/g)) constants[match[1]!] = expand(match[3]!);
      const actions = src.match(/for\s*\(const action of \[([^\]]+)\]/)?.[1].match(/['"](\w+)['"]/g)?.map(action => action.slice(1, -1)) ?? [];
      for (const match of src.matchAll(/\.(get|post|put|patch|delete)\(\s*(?:([\w]+)|`([^`]+)`)/g)) {
        const route = match[2] ? constants[match[2]] : expand(match[3]!);
        if (!route) continue;
        for (const resolved of route.includes('${action}') ? actions.map(action => route.replace('${action}', action)) : [route]) out.add(`${match[1]!.toUpperCase()} /api${resolved}`);
      }
      continue;
    }
    for (const m of src.matchAll(/\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) out.add(`${m[1]!.toUpperCase()} /api${m[2]}`);
    for (const m of src.matchAll(/app\.(get|post|put|patch|delete)\(\s*(?:prefix\b|`\$\{prefix\}([^`]*)`)/g)) {
      out.add(`${m[1]!.toUpperCase()} /api/systems/:id/realizations/:rid${m[2] ?? ""}`);
    }
  }
  // Route handlers in index.ts; the `knownSystem` middleware registrations there are not routes.
  for (const m of readFileSync(join(worker, "index.ts"), "utf8").matchAll(/app\.(get|post)\("([^"]+)",\s*\(/g)) out.add(`${m[1]!.toUpperCase()} ${m[2]}`);
  return out;
}

describe("the Artyfact self-Genome", () => {
  const files = genomeFiles(genomeDir);
  const model = loadGenome(files, { templates: metaTemplates });
  const { graph } = model;
  const tree = parseTree(files);
  const readiness = validate(model);
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
      // Workspace packages are scoped; the published CLI is the unscoped `artyfact`.
      expect(pkg.name, t.id).toMatch(/^(@artyfact\/|artyfact$)/);
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
      const pkg = JSON.parse(readFileSync(join(repo, tree.nodes.get(t.id)!.file.root!, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string>;
      };
      // A package with a `bundle` script compiles its workspace dependencies in: they are devDependencies at publish
      // time and still what the Thing depends on.
      const declared = { ...(pkg.scripts?.bundle ? pkg.devDependencies : {}), ...pkg.dependencies };
      const want = Object.keys(declared).filter((d) => byPackage.has(d)).map((d) => byPackage.get(d)!).sort();
      const have = graph.links.filter((l) => l.from === t.id && l.rel === "dependsOn").map((l) => l.to).sort();
      expect(have, t.id).toEqual(want);
    }
  });

  it("binds every self artifact to the CLI-derived shared Artyfact app repository", () => {
    const artifacts = graph.nodes.filter((node) => node.kind === "artifact");
    expect(artifacts.map((artifact) => artifact.id).sort()).toEqual([
      "artifact.ci", "artifact.cli", "artifact.effects", "artifact.model", "artifact.ontology", "artifact.platform", "artifact.rules", "artifact.semantic", "artifact.site", "artifact.templates",
    ]);
    expect(new Set(artifacts.map((artifact) => artifact.fields.repo))).toEqual(new Set(["artyfact.app"]));
    expect(artifacts.find((artifact) => artifact.id === "artifact.platform")?.fields.type).toBe("worker-fullstack");
  });

  it("loads through loadGenome with no findings under its pinned packs, and topology.services runs and passes", () => {
    expect(model.kits.rulePacks).toEqual([{ id: "topology.services", version: "1" }]);
    expect(model.things).toHaveLength(10);
    // Only semantic check candidates (info) remain; they need System One.
    expect(readiness.findings.filter((f) => f.level !== "info").map((f) => [f.rule, f.subject, f.message])).toEqual([]);
    expect(readiness.findings.filter((f) => f.level === "info").every((f) => f.rule.startsWith("semantic:"))).toBe(true);
    expect(readiness.packs.map((p) => p.id)).toContain("topology.services");
    expect(readiness.actionable).toBe(true);
  });

  it("names the platform's Durable Object, the CI Workflow and the CLI's real commands", () => {
    const field = (id: string, f: string) => graph.nodes.find((n) => n.id === id)?.fields[f];
    expect(field("durable-object.system-authority", "className")).toBe("SystemAuthority");
    expect(field("workflow.artyfact-ci", "name")).toBe("ArtyfactCI");
    expect(readFileSync(join(repo, "apps/platform/worker/index.ts"), "utf8")).toContain("SystemAuthority");
    const main = readFileSync(join(repo, "packages/cli/src/main.ts"), "utf8");
    for (const c of graph.nodes.filter((n) => n.kind === "command" && n.parent === "thing.cli.commands")) expect(main, c.id).toContain(`case "${c.fields.name}"`);
  });

  it("models the model page itself and keeps human review distinct from executable accuracy checks", () => {
    expect(tree.nodes.get("page.model")?.parent).toBe("thing.site.pages");
    expect(tree.nodes.get("component.model-explanation")?.parent).toBe("page.model");
    expect(tree.nodes.get("affordance.model.inspect-views")?.parent).toBe("component.model-explanation");
    expect(tree.nodes.get("purpose.explain-artyfact")?.parent).toBe("system.artyfact");
    expect(graph.links).toContainEqual(expect.objectContaining({ from: "component.model-explanation", rel: "serves", to: "purpose.explain-artyfact" }));
    const criteria = tree.nodes.get("component.model-explanation")!.file.criteria!;
    expect(criteria.map((c) => c.id)).toEqual([
      "C.site.model.accurate-representation", "C.site.model.clear-communication", "C.site.model.compelling-visual-presentation",
    ]);
    for (const c of criteria) {
      expect(graph.links).toContainEqual(expect.objectContaining({ from: c.id, rel: "owner", to: "thing.site" }));
      expect(graph.links).toContainEqual(expect.objectContaining({ from: c.id, rel: "subject", to: "component.model-explanation" }));
    }
    expect(criteria[0]).toMatchObject({ target: "artifact", gates: ["candidate", "promotion"] });
    expect(criteria[0]!.hooks?.[0]).toMatchObject({ engine: "vitest", inputs: { command: "pnpm --filter @artyfact/site test test/model-content.test.tsx test/public-model.test.tsx" } });
    expect(criteria[1]).toMatchObject({ target: "observation", deferred: true, gates: ["outcome"] });
    expect(criteria[1]!.hooks).toBeUndefined();
    expect(criteria[1]!.claim).toContain("review remains pending");
    // Artyfact judges its own page visually: platform captures of /model at desktop and mobile, judged by Clef.
    expect(criteria[2]).toMatchObject({ target: "runtime", severity: "soft", gates: ["candidate"] });
    expect(criteria[2]!.deferred).toBeFalsy();
    expect(criteria[2]!.hooks?.[0]).toMatchObject({ engine: "browser", triggers: ["candidate"], binding: "bound", inputs: { judgment: "visual", path: "/model", viewports: "desktop,mobile" } });
  });

  it("has one platform endpoint per route the Worker registers, and none it does not", () => {
    const endpoints = graph.nodes.filter((n) => n.kind === "endpoint" && n.parent === "thing.platform.api").map((n) => String(n.fields.route));
    expect(endpoints.length).toBe(new Set(endpoints).size);
    expect(endpoints.sort()).toEqual([...platformRoutes()].sort());
  });

  it("maps integrity, proposal recovery, CLI and review surfaces to their actual contracts", () => {
    const route = (id: string) => graph.nodes.find((n) => n.id === id)?.fields.route;
    expect(route("endpoint.integrity-preview")).toBe("POST /api/systems/:id/integrity/preview");
    expect(route("endpoint.integrity-runs")).toBe("GET /api/systems/:id/integrity/runs");
    expect(route("endpoint.integrity-run")).toBe("GET /api/systems/:id/integrity/runs/:runId");
    expect(route("endpoint.integrity-cancel")).toBe("POST /api/systems/:id/integrity/runs/:runId/cancel");
    expect(route("endpoint.integrity-agreement")).toBe("POST /api/systems/:id/integrity/runs/:runId/agreement");
    expect(route("endpoint.intents-revise")).toBe("POST /api/systems/:id/intents/:pid/revise");
    expect(route("endpoint.intents-abandon")).toBe("POST /api/systems/:id/intents/:pid/abandon");
    for (const id of ["module.platform.integrity", "module.cli.integrity", "command.ontology-check", "command.ontology-agreement", "command.ontology-materialize", "screen.start", "component.start.integrity", "component.review.integrity"]) {
      expect(graph.nodes.some((n) => n.id === id), id).toBe(true);
    }
    expect(graph.links).toContainEqual(expect.objectContaining({ from: "module.platform.integrity", rel: "implements", to: "endpoint.integrity-runs" }));
    expect(graph.links).toContainEqual(expect.objectContaining({ from: "affordance.start.preview-integrity", rel: "invokes", to: "endpoint.integrity-preview" }));
    expect(graph.links).toContainEqual(expect.objectContaining({ from: "component.review.integrity", rel: "references", to: "component.start.integrity" }));
  });

  it("links journey steps to the endpoints and commands they run", () => {
    const ops = graph.links.filter((l) => l.rel === "stepOperation");
    const kinds = new Set(ops.map((l) => graph.nodes.find((n) => n.id === l.to)?.kind));
    expect([...kinds].sort()).toEqual(["command", "endpoint", "workflow"]);
    for (const j of ["J.describe-change", "J.realize", "J.promote", "J.compare", "J.lifecycle"]) expect(ops.some((l) => l.from.startsWith(`${j}/`)), j).toBe(true);
  });

  it("records the intended authoring and integrity loop without treating proposed checks as shipped", () => {
    const node = (id: string) => graph.nodes.find((candidate) => candidate.id === id);
    for (const id of ["feature.intent-integrity", "commitment.intent-fidelity", "commitment.integrity-review", "J.author-intent"]) {
      expect(node(id), id).toBeDefined();
    }
    expect(graph.links).toContainEqual(expect.objectContaining({ from: "J.author-intent", rel: "serves", to: "feature.intent-integrity" }));
    expect(node("feature.intent-integrity")?.fields.summary).toMatch(/proposed/i);
    expect(node("commitment.integrity-review")?.fields.statement).toMatch(/does not itself establish user agreement/i);
    expect(node("commitment.intent-fidelity")?.fields.statement).toMatch(/assumptions.*disagreements/i);
  });

  it("pins a source-backed intent brief and manifest for the self-Genome", () => {
    const briefPath = join(genomeDir, "intent/brief.md");
    const manifestPath = join(genomeDir, "intent/manifest.json");
    const brief = readFileSync(briefPath, "utf8");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version: number;
      nodes: Array<{ nodeId: string; briefSections: string[]; documents: Array<{ path: string; hash: string }> }>;
    };
    expect(Buffer.byteLength(brief, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(manifest.version).toBe(1);
    expect(Buffer.byteLength(JSON.stringify(manifest), "utf8")).toBeLessThanOrEqual(128 * 1024);
    expect(manifest.nodes.map((entry) => entry.nodeId).sort()).toEqual([
      "J.author-intent", "commitment.integrity-review", "commitment.intent-fidelity", "feature.intent-integrity", "system.artyfact", "thing.site",
    ]);
    for (const entry of manifest.nodes) {
      expect(entry.briefSections.length, entry.nodeId).toBeGreaterThan(0);
      for (const source of entry.documents) {
        expect(source.path).toMatch(/^(?!\/)(?!.*(?:^|\/)\.?(?:\/|$))[A-Za-z0-9][A-Za-z0-9._/-]*$/);
        const expected = createHash("sha256").update(readFileSync(join(repo, source.path))).digest("hex");
        expect(source.hash, `${entry.nodeId}: ${source.path}`).toBe(`sha256:${expected}`);
      }
    }
  });

  it("keeps source-free intent controls explicit about expected integrity outcomes", () => {
    const examples = join(repo, "examples/intent-integrity");
    const expected = new Map([
      ["new-idea", "needs-review"],
      ["amendment", "needs-review"],
      ["flawed", "blocked"],
      ["clean", "passed"],
    ]);
    for (const [name, status] of expected) {
      const dir = join(examples, name);
      const brief = readFileSync(join(dir, "brief.md"), "utf8");
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { version: number; nodes: unknown[] };
      const findings = JSON.parse(readFileSync(join(dir, "expected-findings.json"), "utf8")) as { expectedStatus: string; findings: Array<{ id: string; section: string }> };
      expect(brief).not.toMatch(/(?:token|password|secret|https?:\/\/)/i);
      expect(manifest).toMatchObject({ version: 1 });
      expect(manifest.nodes.length).toBeGreaterThan(0);
      expect(findings.expectedStatus).toBe(status);
      if (name === "flawed") expect(findings.findings.map((finding) => finding.section).sort()).toEqual(["semantic", "semantic", "semantic", "semantic", "structural"]);
    }
  });

  it("maps every non-ignored source file under apps/ and packages/ to at least one node", () => {
    const ignored = ignoreFilter(readFileSync(join(repo, ".artyfactignore"), "utf8"));
    const files = execFileSync("git", ["ls-files", "apps", "packages"], { cwd: repo, encoding: "utf8" }).split("\n").filter((f) => f && !ignored(f));
    expect(files.length).toBeGreaterThan(300);
    const matchers = [...effectiveGlobs(tree).values()].flat().map((g) => picomatch(g, { dot: true }));
    const unmapped = files.filter((f) => !matchers.some((m) => m(f)));
    expect(unmapped).toEqual([]);
  });

  it("names only files that exist in each node's own files", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
    const stale: string[] = [];
    for (const n of tree.nodes.values()) {
      let root: string | undefined;
      for (let x: TreeNode | undefined = n; x && root === undefined; x = x.parent === undefined ? undefined : tree.nodes.get(x.parent)) root = x.file.root;
      for (const g of n.file.files ?? []) {
        const m = picomatch(root ? `${root}/${g}` : g, { dot: true });
        if (!tracked.some((f) => m(f))) stale.push(`${n.id}: ${g}`);
      }
    }
    expect(stale).toEqual([]);
  });
});
