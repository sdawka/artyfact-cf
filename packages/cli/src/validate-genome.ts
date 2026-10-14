import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import picomatch from "picomatch";
import { parse as parseYaml } from "yaml";
import { LegacyGenomeError, loadGenome, ModelParseError, validate, type Finding, type TemplateStore } from "@artyfact/model";
import { parseTree } from "@artyfact/ontology";
import { readDir } from "@artyfact/ontology/artyfact/node";
import { isLegacyGenome } from "@artyfact/ontology/genome";
import { metaTemplates } from "@artyfact/templates";
import { CliError } from "./git.ts";
import type { Io } from "./main.ts";
import { projectFiles } from "./safety.ts";

const USAGE = "usage: artyfact validate-genome <genomeDir> [--app dir] [--templates dir] [--json] [--strict]";

interface Reported { level: string; rule: string; subject?: string; message: string }

/** Tracked files of the app: `git ls-files` in `dir`, else every pushable file; minus `<dir>/.artyfactignore` patterns. */
export function appPaths(dir: string): string[] {
  const r = spawnSync("git", ["-C", dir, "--literal-pathspecs", "ls-files", "-z", "--", "."], { encoding: "utf8", maxBuffer: 64 << 20 });
  const all = r.status === 0 ? r.stdout.split("\0").filter(Boolean) : projectFiles(dir).files;
  const ignorePath = join(dir, ".artyfactignore");
  const patterns = existsSync(ignorePath)
    ? readFileSync(ignorePath, "utf8").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"))
    : [];
  const ignored = ignoreMatcher(patterns);
  return all.filter((p) => existsSync(join(dir, p)) && !ignored(p)).sort();
}

/** Gitignore-style lines: `dir/` matches the directory anywhere, a leading `/` anchors at the root, others match a path or any segment. */
function ignoreMatcher(patterns: string[]): (path: string) => boolean {
  const ms = patterns.map((raw) => {
    const dirOnly = raw.endsWith("/");
    const body = raw.replace(/\/$/, "");
    const anchored = body.startsWith("/") || body.includes("/");
    const glob = body.replace(/^\//, "");
    const opts = { dot: true };
    const self = picomatch(glob, opts);
    return (path: string) => {
      const segs = path.split("/");
      for (let i = 1; i <= segs.length; i++) {
        const isDir = i < segs.length;
        if (dirOnly && !isDir) continue;
        if (anchored ? self(segs.slice(0, i).join("/")) : self(segs[i - 1]!)) return true;
      }
      return false;
    };
  });
  return (path) => ms.some((m) => m(path));
}

/**
 * `artyfact validate-genome <genomeDir> [--app dir]`: loads the node tree as the platform's import does, runs the readiness
 * rules and, with `--app`, reports app paths no node maps (`unmapped`) and a node's own `files` globs matching nothing (`stale`).
 */
export function validateGenomeCommand(argv: string[], io: Pick<Io, "cwd" | "out">): number {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { app: { type: "string" }, templates: { type: "string" }, json: { type: "boolean" }, strict: { type: "boolean" } }, allowPositionals: true });
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  if (parsed.positionals.length !== 1) throw new CliError(USAGE);
  const arg = parsed.positionals[0]!;
  const genomeDir = resolve(io.cwd, arg);
  if (!existsSync(genomeDir) || !lstatSync(genomeDir).isDirectory()) throw new CliError(`${arg} is not a directory`);
  const appArg = parsed.values.app;
  const appDir = appArg === undefined ? undefined : resolve(io.cwd, appArg);
  if (appDir && (!existsSync(appDir) || !lstatSync(appDir).isDirectory())) throw new CliError(`${appArg} is not a directory`);
  let templates: TemplateStore = metaTemplates;
  if (parsed.values.templates !== undefined) {
    const tplDir = resolve(io.cwd, parsed.values.templates);
    if (!existsSync(tplDir)) throw new CliError(`templates directory ${parsed.values.templates} not found`);
    const local = readDir(tplDir);
    templates = {
      get(ref) {
        const m = /^template\.(system|thing)\.([\w.-]+@[\w.-]+)$/.exec(ref);
        const text = m ? local[`${m[1]}/${m[2]}/template.yaml`] : undefined;
        return text === undefined ? metaTemplates.get(ref) : parseYaml(text);
      },
    };
  }

  const files = readDir(genomeDir);
  if (isLegacyGenome(Object.keys(files))) throw new CliError(new LegacyGenomeError().message);

  const json = parsed.values.json === true;
  const emitFailure = (findings: Reported[]): number => {
    if (json) io.out(JSON.stringify({ system: null, template: null, genomeDir: arg, appDir: appArg ?? null, counts: { nodes: 0, criteria: 0, hooks: 0, journeys: 0, evolutions: 0 }, findings, unmapped: [], stale: [], ok: false }, null, 2));
    else {
      io.out(`(unloadable)  (genome: ${arg})`);
      io.out(`findings: ${findings.length} errors, 0 warnings`);
      for (const f of findings) io.out(`  error   ${f.rule}  ${f.subject ?? ""}: ${f.message}`);
      io.out("not ok: fix the errors above");
    }
    return 1;
  };

  let model;
  try {
    model = loadGenome(files, { templates });
  } catch (e) {
    if (e instanceof ModelParseError) {
      return emitFailure(e.issues.map((i) => {
        const file = i.path.length ? String(i.path[0]) : e.file;
        return { level: "error", rule: e.code, subject: file, message: i.message.startsWith(`${file}: `) ? i.message.slice(file.length + 2) : i.message };
      }));
    }
    throw e;
  }

  const findings: Reported[] = validate(model).findings
    .filter((f: Finding) => f.level !== "info")
    .map((f) => ({ level: f.level, rule: f.rule, ...(f.subject !== undefined && { subject: f.subject }), message: f.message }));
  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.length - errors;

  const tree = parseTree(files);
  const rootOf = (id: string): string | undefined => {
    for (let n = tree.nodes.get(id); n; n = n.parent === undefined ? undefined : tree.nodes.get(n.parent)) if (n.file.root !== undefined) return n.file.root;
    return undefined;
  };

  let unmapped: string[] = [], stale: { node: string; glob: string }[] = [], paths: string[] | undefined;
  if (appDir) {
    paths = appPaths(appDir);
    const matchers = Object.values(model.files).flat().map((g) => picomatch(g.glob, { dot: true }));
    unmapped = paths.filter((p) => !matchers.some((m) => m(p)));
    for (const [id, globs] of Object.entries(model.files)) {
      for (const g of globs) {
        if (!g.declared) continue;
        const m = picomatch(g.glob, { dot: true });
        if (!paths.some((p) => m(p))) {
          const root = rootOf(id);
          stale.push({ node: id, glob: root && g.glob.startsWith(`${root}/`) ? g.glob.slice(root.length + 1) : g.glob });
        }
      }
    }
    stale.sort((a, b) => a.node.localeCompare(b.node) || a.glob.localeCompare(b.glob));
  }

  const counts = { nodes: tree.nodes.size, criteria: model.criteria.length, hooks: model.hooks.length, journeys: model.journeys.length, evolutions: model.evolutions.length };
  const template = model.system.template;
  const strictFail = parsed.values.strict === true && (unmapped.length > 0 || stale.length > 0);
  const ok = errors === 0;
  if (json) {
    io.out(JSON.stringify({ system: model.system.id, template, genomeDir: arg, appDir: appArg ?? null, counts, findings, unmapped, stale, ok }, null, 2));
  } else {
    io.out(`${model.system.id}  ${template ?? "(no template)"}  (genome: ${arg})`);
    io.out(`things: ${tree.root ? [...tree.nodes.values()].filter((n) => n.file.kind === "thing").map((n) => `${n.id} (root ${n.file.root ?? "."}, ${n.file.template ?? "no template"})`).join("; ") : ""}`);
    io.out(`nodes ${counts.nodes}  criteria ${counts.criteria}  hooks ${counts.hooks}  journeys ${counts.journeys}  evolutions ${counts.evolutions}`);
    io.out(`findings: ${errors} errors, ${warnings} warnings`);
    for (const f of findings) io.out(`  ${f.level.padEnd(7)} ${f.rule}  ${f.subject ?? "-"}: ${f.message}`);
    if (paths) {
      io.out(`files: ${paths.length - unmapped.length} of ${paths.length} app paths mapped (app: ${appArg})`);
      for (const p of unmapped) io.out(`  unmapped  ${p}`);
      for (const s of stale) io.out(`  stale     ${s.node}: ${s.glob}`);
    } else {
      io.out("files: no app dir given (--app)");
    }
    if (ok) {
      io.out("structural validation passed; semantic integrity and human agreement were not checked.");
      io.out(`next: \`npx artyfact ontology check --system ${model.system.id} --genome ${arg} --platform <origin>\``);
    } else io.out("not ok: fix the errors above");
  }
  return ok && !strictFail ? 0 : 1;
}
