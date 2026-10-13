import { spawnSync } from "node:child_process";
import { constants, closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, writeSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import {
  composeParts, extractPart, partDigest, schema, upgradeComposition,
  type PartPackage, type PartPayload, type PartRecipe, type PartRef, type SavedComposition,
} from "@artyfact/model";
import { NODE_FILE, parseTree } from "@artyfact/ontology";
import { CliError } from "./git.ts";
import { isSecretFile } from "./ignore.ts";
import { assertBearerTransport, resolvePlatform } from "./platform-url.ts";
import type { Io } from "./main.ts";

const META_DIR = ".artyfact";
const COMPOSITION_FILE = "composition.json";
const BASELINE_FILE = "baseline.json";
const OMIT_DIRS = new Set(["node_modules", ".git", ".wrangler", META_DIR, "dist", "build", "coverage", ".cache", ".next", ".turbo"]);

type Values = Record<string, string | boolean | undefined>;

function lstatMaybe(path: string): Stats | undefined {
  try { return lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function parse(args: string[], options: Record<string, { type: "string" | "boolean" }>) {
  try {
    const parsed = parseArgs({ args, options, allowPositionals: true });
    return { values: parsed.values as Values, positionals: parsed.positionals };
  } catch (error) {
    throw new CliError((error as Error).message);
  }
}

function jsonFile<T>(path: string, label: string, parseValue: (value: unknown) => T): T {
  const absolute = resolve(path);
  let stat;
  try { stat = lstatSync(absolute); } catch { throw new CliError(`${label} ${absolute} does not exist`); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CliError(`${label} must be a regular, non-symlink file: ${absolute}`);
  try { return parseValue(JSON.parse(readFileSync(absolute, "utf8"))); }
  catch (error) { throw new CliError(`invalid ${label} ${absolute}: ${(error as Error).message}`); }
}

function partFile(path: string): PartPackage {
  return jsonFile(path, "Part package", (value) => {
    const envelope = value && typeof value === "object" ? value as { part?: unknown } : {};
    return schema.PartPackage.parse(envelope.part ?? value);
  });
}

function validRelativePath(path: string, label: string): string {
  if (!path || isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new CliError(`${label} must be a safe relative POSIX path: ${JSON.stringify(path)}`);
  }
  const parts = path.split("/");
  if (parts.some((part) => OMIT_DIRS.has(part)) || isSecretFile(parts.at(-1)!) || parts.at(-1)!.endsWith(".tsbuildinfo")) {
    throw new CliError(`${label} uses an excluded dependency, cache, build, metadata, or secret path: ${path}`);
  }
  return path;
}

function validatePayload(payload: PartPayload): void {
  for (const path of Object.keys(payload.model)) validRelativePath(path, "model path");
  for (const path of Object.keys(payload.files)) validRelativePath(path, "source path");
}

function walkContent(root: string, rel = ""): Record<string, string> {
  const rootStat = lstatMaybe(root);
  if (!rootStat) return {};
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new CliError(`source root must be a non-symlink directory: ${root}`);
  const output: Record<string, string> = {};
  for (const name of readdirSync(join(root, rel)).sort()) {
    const path = rel ? `${rel}/${name}` : name;
    if (OMIT_DIRS.has(name) || isSecretFile(name) || name.endsWith(".tsbuildinfo") || name === ".DS_Store") continue;
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) Object.assign(output, walkContent(root, path));
    else if (stat.isFile()) {
      const bytes = readFileSync(absolute);
      const text = bytes.toString("utf8");
      if (bytes.includes(0) || !Buffer.from(text, "utf8").equals(bytes)) {
        throw new CliError(`binary files are not supported in Part payloads: ${absolute}`);
      }
      output[validRelativePath(path, "source path")] = text;
    }
  }
  return output;
}

function sourcePayload(source: string): PartPayload {
  const root = resolve(source);
  const rootStat = lstatMaybe(root);
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new CliError(`--source must be a non-symlink directory: ${root}`);
  }
  const payload = { model: walkContent(join(root, "genome")), files: walkContent(join(root, "app")) };
  validatePayload(payload);
  return payload;
}

function parentChain(path: string): string[] {
  const absolute = resolve(path);
  const parents: string[] = [];
  let cursor = dirname(absolute);
  for (;;) {
    parents.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return parents.reverse();
}

function assertSafeParent(path: string): void {
  for (const dir of parentChain(path)) {
    const stat = lstatMaybe(dir);
    if (!stat) continue;
    // macOS exposes its private temporary hierarchy through fixed system aliases.
    const macosSystemAlias = stat.isSymbolicLink() && ((dir === "/var" && resolve(dirname(dir), readlinkSync(dir)) === "/private/var")
      || (dir === "/tmp" && resolve(dirname(dir), readlinkSync(dir)) === "/private/tmp"));
    if ((!stat.isDirectory() || stat.isSymbolicLink()) && !macosSystemAlias) throw new CliError(`refusing symlinked output parent: ${dir}`);
  }
}

function ensureSafeParent(path: string): void {
  assertSafeParent(path);
  const parents = parentChain(path);
  for (const dir of parents) {
    if (!lstatMaybe(dir)) mkdirSync(dir);
  }
}

function writeNewJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  if (lstatMaybe(absolute)) throw new CliError(`refusing to overwrite existing output: ${absolute}`);
  ensureSafeParent(absolute);
  const staging = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  try { writeSync(fd, `${JSON.stringify(value, null, 2)}\n`); } finally { closeSync(fd); }
  try { renameSync(staging, absolute); } catch (error) { rmSync(staging, { force: true }); throw error; }
}

function replaceJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  ensureSafeParent(absolute);
  const existing = lstatMaybe(absolute);
  if (existing?.isSymbolicLink()) throw new CliError(`refusing to replace symlink: ${absolute}`);
  const staging = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  const fd = openSync(staging, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  try { writeSync(fd, `${JSON.stringify(value, null, 2)}\n`); } finally { closeSync(fd); }
  try { renameSync(staging, absolute); } catch (error) { rmSync(staging, { force: true }); throw error; }
}

function commandCwd(root: string, cwd: string | undefined): string {
  const rel = cwd ?? ".";
  if (isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new CliError(`command cwd must stay inside the generated app: ${JSON.stringify(rel)}`);
  const target = resolve(root, rel);
  if (target !== root && !target.startsWith(root + sep)) throw new CliError(`command cwd escapes generated app: ${JSON.stringify(rel)}`);
  const targetStat = lstatMaybe(target);
  if (!targetStat || !targetStat.isDirectory() || targetStat.isSymbolicLink()) throw new CliError(`command cwd is not a generated directory: ${rel}`);
  return target;
}

function commandDeltas(before: PartPayload, after: PartPayload, command: SavedComposition["commands"][number]): schema.PartOutputMapping[] {
  const output: schema.PartOutputMapping[] = [];
  for (const kind of ["model", "file"] as const) {
    const oldContent = kind === "model" ? before.model : before.files;
    const newContent = kind === "model" ? after.model : after.files;
    for (const path of [...new Set([...Object.keys(oldContent), ...Object.keys(newContent)])].sort()) {
      const oldValue = Object.hasOwn(oldContent, path) ? oldContent[path] : undefined;
      const newValue = Object.hasOwn(newContent, path) ? newContent[path] : undefined;
      if (oldValue === newValue) continue;
      const action = oldValue === undefined ? "created" : newValue === undefined ? "deleted" : "changed";
      output.push({
        kind, path, contribution: command.contribution,
        disposition: action === "deleted" ? "excluded" : "adapted",
        by: `command:${command.contribution}/${command.id}`,
        command: { id: command.id, contribution: command.contribution, action },
      });
    }
  }
  return output;
}

function runCommands(composition: SavedComposition, compositionRoot: string, io: Io): schema.PartOutputMapping[] {
  const appRoot = join(compositionRoot, "app");
  const deltas: schema.PartOutputMapping[] = [];
  for (const command of composition.commands) {
    const before = schema.PartPayload.parse({ model: walkContent(join(compositionRoot, "genome")), files: walkContent(appRoot) });
    const cwd = commandCwd(appRoot, command.cwd);
    io.out(`Run [${command.contribution}/${command.id}] ${command.run}`);
    const result = spawnSync(command.run, { cwd, shell: true, encoding: "utf8", timeout: 120_000, maxBuffer: 1 << 20, env: process.env });
    if (result.stdout) for (const line of result.stdout.trimEnd().split("\n")) io.out(line);
    if (result.stderr) for (const line of result.stderr.trimEnd().split("\n")) io.err(line);
    if (result.error) throw new CliError(`command ${command.id} failed: ${result.error.message}`);
    if (result.status !== 0) throw new CliError(`command ${command.id} failed with exit ${result.status ?? "unknown"}`);
    const after = schema.PartPayload.parse({ model: walkContent(join(compositionRoot, "genome")), files: walkContent(appRoot) });
    deltas.push(...commandDeltas(before, after, command));
  }
  return deltas;
}

function addCommandProvenance(composition: SavedComposition, deltas: schema.PartOutputMapping[]): SavedComposition {
  const outputs = composition.provenance.outputs.map((mapping) => ({ ...mapping }));
  for (const delta of deltas) {
    if (delta.command?.action !== "created") {
      const original = outputs.findLast((mapping) => mapping.kind === delta.kind && mapping.path === delta.path
        && mapping.sourcePath !== undefined && mapping.disposition !== "excluded");
      if (original) {
        original.disposition = delta.disposition;
        original.by = delta.by;
        original.command = delta.command;
      }
    }
    outputs.push(delta);
  }
  return { ...composition, provenance: { ...composition.provenance, outputs } };
}

function writeTree(root: string, content: Record<string, string>): void {
  for (const [path, value] of Object.entries(content).sort(([a], [b]) => a.localeCompare(b))) {
    validRelativePath(path, "output path");
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    try { writeSync(fd, value); } finally { closeSync(fd); }
  }
}

function validateComposition(composition: SavedComposition): void {
  validatePayload(composition);
  for (const command of composition.commands) {
    if (command.cwd !== undefined && (isAbsolute(command.cwd) || command.cwd.split(/[\\/]/).includes(".."))) {
      throw new CliError(`command ${command.id} has an unsafe cwd`);
    }
  }
  // Partial model Parts are valid. Once composition supplies a System root (`node.yaml`), it is a complete Genome
  // candidate and must pass the tree parser the platform loads it with before any generated destination is touched.
  if (Object.hasOwn(composition.model, NODE_FILE)) {
    try { parseTree(composition.model); }
    catch (error) { throw new CliError(`generated Genome is invalid: ${(error as Error).message}`); }
  }
}

function adaptGeneratedComposition(composition: SavedComposition, parent: string, io: Io): SavedComposition {
  const staging = mkdtempSync(join(parent, ".artyfact-command-work-"));
  try {
    mkdirSync(join(staging, "genome")); mkdirSync(join(staging, "app"));
    writeTree(join(staging, "genome"), composition.model); writeTree(join(staging, "app"), composition.files);
    const deltas = runCommands(composition, staging, io);
    const actual = schema.PartPayload.parse({ model: walkContent(join(staging, "genome")), files: walkContent(join(staging, "app")) });
    const adapted = addCommandProvenance({ ...composition, model: actual.model, files: actual.files }, deltas);
    validateComposition(adapted);
    return adapted;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function saveNewComposition(output: string, composition: SavedComposition, execute: boolean, io: Io, generatedBaseline?: PartPayload): void {
  validateComposition(composition);
  const target = resolve(output);
  if (lstatMaybe(target)) throw new CliError(`compose output must not exist; use parts upgrade for an existing composition: ${target}`);
  ensureSafeParent(target);
  const staging = mkdtempSync(join(dirname(target), ".artyfact-compose-work-"));
  let final: string | undefined;
  try {
    mkdirSync(join(staging, "genome"));
    mkdirSync(join(staging, "app"));
    writeTree(join(staging, "genome"), composition.model);
    writeTree(join(staging, "app"), composition.files);
    const actual = execute
      ? adaptGeneratedComposition(composition, dirname(target), io)
      : { ...composition, ...schema.PartPayload.parse({ model: walkContent(join(staging, "genome")), files: walkContent(join(staging, "app")) }) };
    validateComposition(actual);
    final = mkdtempSync(join(dirname(target), ".artyfact-compose-final-"));
    mkdirSync(join(final, "genome")); mkdirSync(join(final, "app")); mkdirSync(join(final, META_DIR));
    writeTree(join(final, "genome"), actual.model); writeTree(join(final, "app"), actual.files);
    writeNewJson(join(final, META_DIR, COMPOSITION_FILE), actual);
    writeNewJson(join(final, META_DIR, BASELINE_FILE), generatedBaseline ?? { model: actual.model, files: actual.files });
    rmSync(staging, { recursive: true, force: true });
    renameSync(final, target);
    final = undefined;
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (final) rmSync(final, { recursive: true, force: true });
    throw error;
  }
}

async function requestJson(io: Io, token: string | undefined, method: string, base: string, path: string, body?: unknown): Promise<unknown> {
  if (token) assertBearerTransport(base, "the Parts catalog credential");
  let response: Response;
  try {
    response = await (io.fetch ?? fetch)(`${base.replace(/\/$/, "")}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new CliError(`cannot reach Parts catalog at ${base}: ${(error as Error).message}`);
  }
  const text = await response.text();
  if (!response.ok) throw new CliError(`${method} ${path} -> ${response.status} ${text}`.trim());
  return text ? JSON.parse(text) : {};
}

async function loadCatalogRecipe(recipe: PartRecipe, io: Io, platform: string, systemId?: string): Promise<Map<string, PartPackage>> {
  const cache = new Map<string, PartPackage>();
  const token = io.env.ARTYFACT_ADMIN_TOKEN || io.env.ARTYFACT_SECRET;
  const visit = async (ref: PartRef): Promise<void> => {
    const coordinate = `${ref.id}@${ref.version}`;
    if (cache.has(coordinate)) return;
    let payload: unknown;
    try {
      payload = await requestJson(io, undefined, "GET", platform, `/api/parts/${encodeURIComponent(ref.id)}/${encodeURIComponent(ref.version)}`);
    } catch (error) {
      if (!systemId) throw error;
      if (!token) throw new CliError("private Part reads require ARTYFACT_ADMIN_TOKEN or ARTYFACT_SECRET");
      payload = await requestJson(io, token, "GET", platform,
        `/api/systems/${encodeURIComponent(systemId)}/parts/${encodeURIComponent(ref.id)}/${encodeURIComponent(ref.version)}`);
    }
    const record = payload as { part?: unknown };
    const part = schema.PartPackage.parse((record.part as { package?: unknown } | undefined)?.package ?? record.part);
    if (part.id !== ref.id || part.version !== ref.version) throw new CliError(`catalog returned ${part.id}@${part.version} for ${coordinate}`);
    if (part.digest && part.digest !== partDigest(part)) throw new CliError(`${coordinate} digest does not match its immutable content`);
    cache.set(coordinate, part);
    if (part.recipe) for (const contribution of part.recipe.contributions) await visit(contribution.part);
  };
  for (const contribution of recipe.contributions) await visit(contribution.part);
  return cache;
}

function preview(io: Io, action: string, details: unknown): void {
  io.out(`Preview: ${action} (no files or catalog records written)`);
  io.out(JSON.stringify(details, null, 2));
}

async function create(args: string[], io: Io): Promise<number> {
  const { values } = parse(args, {
    id: { type: "string" }, version: { type: "string" }, name: { type: "string" }, description: { type: "string" }, source: { type: "string" }, out: { type: "string" },
    visibility: { type: "string" }, system: { type: "string" }, apply: { type: "boolean" },
  });
  for (const key of ["id", "version", "name", "source", "out"] as const) if (!values[key]) throw new CliError(`parts create requires --${key}`);
  const part = schema.PartPackage.parse({
    id: values.id, version: values.version, name: values.name, description: values.description,
    visibility: values.visibility ?? "shared", systemId: values.system, payload: sourcePayload(resolve(io.cwd, values.source as string)),
  });
  if (!values.apply) { preview(io, `create ${part.id}@${part.version} at ${resolve(io.cwd, values.out as string)}`, part); return 0; }
  writeNewJson(resolve(io.cwd, values.out as string), part);
  io.out(`Created ${part.id}@${part.version}`);
  return 0;
}

function validate(args: string[], io: Io): number {
  const { positionals } = parse(args, {});
  if (!positionals[0]) throw new CliError("usage: artyfact parts validate <part.json>");
  const part = partFile(resolve(io.cwd, positionals[0]));
  validatePayload(part.payload);
  const digest = partDigest(part);
  if (part.digest && part.digest !== digest) throw new CliError(`digest mismatch: declared ${part.digest}, computed ${digest}`);
  io.out(`valid ${part.id}@${part.version} ${digest}`);
  return 0;
}

async function publish(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(args, { platform: { type: "string" }, apply: { type: "boolean" } });
  if (!positionals[0]) throw new CliError("usage: artyfact parts publish <part.json> [--apply]");
  const original = partFile(resolve(io.cwd, positionals[0]));
  validatePayload(original.payload);
  const part = schema.PartPackage.parse({ ...original, published: true, digest: partDigest(original) });
  const path = part.visibility === "system-private"
    ? `/api/systems/${encodeURIComponent(part.systemId!)}/parts`
    : "/api/parts";
  if (!values.apply) { preview(io, `publish ${part.id}@${part.version} to ${path}`, { package: part }); return 0; }
  const token = io.env.ARTYFACT_ADMIN_TOKEN;
  if (!token) throw new CliError("parts publish --apply requires ARTYFACT_ADMIN_TOKEN");
  const platform = await resolvePlatform(values.platform as string | undefined, io.env, io.fetch ?? fetch, io.err);
  await requestJson(io, token, "POST", platform, path, { package: part });
  io.out(`Published ${part.id}@${part.version} ${part.digest}`);
  return 0;
}

async function compose(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(args, {
    out: { type: "string" }, platform: { type: "string" }, system: { type: "string" }, apply: { type: "boolean" }, "run-commands": { type: "boolean" },
  });
  if (!positionals[0] || !values.out) throw new CliError("usage: artyfact parts compose <recipe.json> --out <dir> [--apply] [--run-commands]");
  if (values["run-commands"] && !values.apply) throw new CliError("--run-commands requires --apply");
  const recipe = jsonFile(resolve(io.cwd, positionals[0]), "Part recipe", schema.PartRecipe.parse);
  const platform = await resolvePlatform(values.platform as string | undefined, io.env, io.fetch ?? fetch, io.err);
  const parts = await loadCatalogRecipe(recipe, io, platform, values.system as string | undefined);
  const composition = composeParts(recipe, { get: (ref) => parts.get(`${ref.id}@${ref.version}`) });
  validateComposition(composition);
  if (!values.apply) { preview(io, `compose ${recipe.id} into ${resolve(io.cwd, values.out as string)}`, composition); return 0; }
  saveNewComposition(resolve(io.cwd, values.out as string), composition, values["run-commands"] === true, io);
  io.out(`Composed ${recipe.id}. Review genome/ first; accept that Genome before realizing app/. No deployment was started.`);
  return 0;
}

function extract(args: string[], io: Io): number {
  const { values, positionals } = parse(args, { out: { type: "string" }, apply: { type: "boolean" } });
  if (!positionals[0] || !values.out) throw new CliError("usage: artyfact parts extract <request.json> --out <part.json> [--apply]");
  const request = jsonFile(resolve(io.cwd, positionals[0]), "extraction request", schema.ExtractionRequest.parse);
  const result = extractPart(request);
  validatePayload(result.part.payload);
  if (!values.apply) { preview(io, `extract ${result.part.id}@${result.part.version} to ${resolve(io.cwd, values.out as string)}`, result); return 0; }
  writeNewJson(resolve(io.cwd, values.out as string), result);
  io.out(`Extracted ${result.part.id}@${result.part.version} from ${result.sourceRevision}`);
  return 0;
}

function overwriteExistingTree(root: string, content: Record<string, string>): void {
  for (const [path, value] of Object.entries(content).sort(([a], [b]) => a.localeCompare(b))) {
    validRelativePath(path, "upgrade output path");
    const target = join(root, path);
    const parent = dirname(target);
    ensureSafeParent(target);
    mkdirSync(parent, { recursive: true });
    if (lstatMaybe(target)?.isSymbolicLink()) throw new CliError(`refusing to overwrite symlink: ${target}`);
    const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o644);
    try { writeSync(fd, value); } finally { closeSync(fd); }
  }
}

function removeObsoleteFiles(root: string, before: Record<string, string>, after: Record<string, string>): void {
  for (const path of Object.keys(before).filter((path) => !Object.hasOwn(after, path)).sort()) {
    validRelativePath(path, "obsolete output path");
    const target = join(root, path);
    ensureSafeParent(target);
    const stat = lstatMaybe(target);
    if (!stat) continue;
    if (!stat.isFile() || stat.isSymbolicLink()) throw new CliError(`refusing to remove non-regular output: ${target}`);
    rmSync(target);
  }
}

function preflightFile(path: string): void {
  assertSafeParent(path);
  const stat = lstatMaybe(path);
  if (!stat) return;
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CliError(`refusing symlink or non-regular output target: ${path}`);
}

function preflightUpgrade(from: string, current: PartPayload, staged: PartPayload): void {
  for (const [root, before, after] of [
    [join(from, "genome"), current.model, staged.model],
    [join(from, "app"), current.files, staged.files],
  ] as const) {
    const affected = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const path of [...affected].sort()) {
      validRelativePath(path, "upgrade output path");
      preflightFile(join(root, path));
    }
  }
  preflightFile(join(from, META_DIR, COMPOSITION_FILE));
  preflightFile(join(from, META_DIR, BASELINE_FILE));
}

async function upgrade(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parse(args, {
    from: { type: "string" }, out: { type: "string" }, platform: { type: "string" }, system: { type: "string" }, apply: { type: "boolean" }, "run-commands": { type: "boolean" },
  });
  if (!positionals[0] || !values.from) throw new CliError("usage: artyfact parts upgrade <recipe.json> --from <composition-dir> [--out <dir>] [--apply]");
  if (values["run-commands"] && !values.apply) throw new CliError("--run-commands requires --apply");
  const from = resolve(io.cwd, values.from as string);
  const fromStat = lstatMaybe(from);
  if (!fromStat || !fromStat.isDirectory() || fromStat.isSymbolicLink()) throw new CliError(`--from is not a safe composition directory: ${from}`);
  const baseline = jsonFile(join(from, META_DIR, BASELINE_FILE), "composition baseline", schema.PartPayload.parse);
  const current = schema.PartPayload.parse({ model: walkContent(join(from, "genome")), files: walkContent(join(from, "app")) });
  const recipe = jsonFile(resolve(io.cwd, positionals[0]), "Part recipe", schema.PartRecipe.parse);
  const platform = await resolvePlatform(values.platform as string | undefined, io.env, io.fetch ?? fetch, io.err);
  const parts = await loadCatalogRecipe(recipe, io, platform, values.system as string | undefined);
  const next = composeParts(recipe, { get: (ref) => parts.get(`${ref.id}@${ref.version}`) });
  validateComposition(next);
  const generatedComposition = values["run-commands"]
    ? adaptGeneratedComposition(next, dirname(from), io)
    : next;
  const generatedNext = schema.PartPayload.parse({ model: generatedComposition.model, files: generatedComposition.files });
  const result = upgradeComposition({ baseline, current, next: generatedNext });
  if (result.conflicts.length) {
    for (const conflict of result.conflicts) io.err(`conflict ${conflict.kind} ${conflict.path}`);
    io.err("No files written; resolve the conflicts or update the recipe and retry.");
    return 2;
  }
  const composition: SavedComposition = { ...generatedComposition, model: result.result.model, files: result.result.files };
  validateComposition(composition);
  const output = resolve(io.cwd, (values.out as string | undefined) ?? (values.from as string));
  if (!values.apply) { preview(io, `upgrade ${from} into ${output}`, composition); return 0; }
  if (output !== from) {
    saveNewComposition(output, composition, false, io, generatedNext);
  } else {
    // Fully validate and execute against a staging tree before the first destination write.
    const staging = mkdtempSync(join(dirname(from), ".artyfact-upgrade-"));
    try {
      mkdirSync(join(staging, "genome")); mkdirSync(join(staging, "app"));
      writeTree(join(staging, "genome"), composition.model); writeTree(join(staging, "app"), composition.files);
      const staged = schema.PartPayload.parse({ model: walkContent(join(staging, "genome")), files: walkContent(join(staging, "app")) });
      validateComposition({ ...composition, model: staged.model, files: staged.files });
      preflightUpgrade(from, current, staged);
      removeObsoleteFiles(join(from, "genome"), current.model, staged.model);
      removeObsoleteFiles(join(from, "app"), current.files, staged.files);
      overwriteExistingTree(join(from, "genome"), staged.model);
      overwriteExistingTree(join(from, "app"), staged.files);
      replaceJson(join(from, META_DIR, COMPOSITION_FILE), { ...composition, model: staged.model, files: staged.files });
      replaceJson(join(from, META_DIR, BASELINE_FILE), generatedNext);
    } finally { rmSync(staging, { recursive: true, force: true }); }
  }
  io.out(`Upgraded ${recipe.id}. Review genome/ first; accept that Genome before realizing app/. No deployment was started.`);
  return 0;
}

export async function partsCommand(args: string[], io: Io): Promise<number> {
  const [command, ...rest] = args;
  switch (command) {
    case "create": return create(rest, io);
    case "extract": return extract(rest, io);
    case "validate": return validate(rest, io);
    case "publish": return publish(rest, io);
    case "compose": return compose(rest, io);
    case "upgrade": return upgrade(rest, io);
    default: throw new CliError("usage: artyfact parts create|extract|validate|publish|compose|upgrade ...");
  }
}
