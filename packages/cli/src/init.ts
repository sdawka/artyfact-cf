/**
 * `artyfact init` and `artyfact platform-sync` (slice 2.7): take a project from its Genome (root `node.yaml`) to an imported System.
 * Write tokens reach git only through `GIT_CONFIG_*` (see `gitEnv`); they are never printed or put on an argv.
 */
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { EVOLUTIONS_DIR, NODE_FILE, V1_ROOT_FILE } from "@artyfact/ontology/genome";
import { parseTree } from "@artyfact/ontology";
import { cloudCli, spawnExec, type Cloud } from "./cloud.ts";
import { CliError, git } from "./git.ts";
import { assertName, assertSystemId, assertTemplateRef, copyFiles, isInside, projectFiles, realDir, realSubdir } from "./safety.ts";
import { PLATFORM_REPO, platformTemplateDir, systemRepoNames } from "./naming.ts";
import { assertBearerTransport, DEFAULT_URL, resolvePlatform } from "./platform-url.ts";

export interface InitIo {
  out: (s: string) => void;
  err: (s: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
  cloud?: Cloud;
  fetch?: typeof fetch;
  /** Checkout root holding `packages/templates` (defaults to this package's monorepo). */
  root?: string;
  /** Delay between fork readiness polls (tests use 0). */
  pollMs?: number;
}

const DEFAULT_NAMESPACE = "artyfact";
const IDENTITY = ["-c", "user.name=artyfact", "-c", "user.email=artyfact@localhost"];

const here = dirname(fileURLToPath(import.meta.url));
const defaultRoot = () => resolve(here, "../../..");

function parse(args: string[], options: Record<string, { type: "string" | "boolean" }>) {
  try {
    return parseArgs({ args, options, allowPositionals: false }).values as Record<string, string | boolean | undefined>;
  } catch (e) {
    throw new CliError((e as Error).message);
  }
}

// ------------------------------------------------------------------ project reading

/** `id:` of the root node.yaml (top-level scalar; the CLI carries no YAML dependency). */
export function systemIdOf(yaml: string): string {
  const m = /^id:\s*["']?([^\s"'#]+)["']?\s*(#.*)?$/m.exec(yaml);
  if (!m) throw new CliError(`${NODE_FILE} has no top-level \`id:\``);
  return m[1]!;
}

/** worker-fullstack artifact ids declared in the Things' `node.yaml` (`fields.artifacts`), in path order. */
export function appArtifactIds(genomeDir: string): string[] {
  if (!existsSync(genomeDir)) return [];
  const root = realpathSync(genomeDir), files: Record<string, string> = {};
  const walk = (dir = root) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) walk(path);
      else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) files[relative(root, path).split("\\").join("/")] = readFileSync(path, "utf8");
    }
  };
  walk();
  const tree = parseTree(files);
  const ids = new Set<string>();
  for (const thing of tree.nodes.values()) {
    if (thing.file.kind !== "thing") continue;
    const embedded = thing.file.fields?.artifacts;
    for (const artifact of Array.isArray(embedded) ? embedded : []) {
      if (artifact && typeof artifact === "object" && "artifact" in artifact && "type" in artifact
        && artifact.type === "worker-fullstack" && typeof artifact.artifact === "string") ids.add(artifact.artifact);
    }
    for (const link of thing.file.links ?? []) {
      if (link.rel !== "artifact") continue;
      const artifact = tree.nodes.get(link.to)?.file;
      if (artifact?.kind === "artifact" && artifact.fields?.type === "worker-fullstack") ids.add(artifact.id);
    }
  }
  return [...ids];
}

/** `key: value` lines of a flat YAML file such as scaffold.yaml. */
export function flatYaml(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z_][\w-]*):\s*["']?([^"'#\n]*?)["']?\s*(#.*)?$/.exec(line);
    if (m && m[2]) out[m[1]!] = m[2];
  }
  return out;
}

// ------------------------------------------------------------------ git plumbing

interface Remote { url: string; token: string }

function lsRemoteHead(cwd: string, r: Remote): string {
  return git(cwd, ["ls-remote", "--", r.url, "refs/heads/main"], r.token).split(/\s/)[0] ?? "";
}

/**
 * A scratch git dir whose index holds exactly the project tree of `src` (a real path): the files {@link projectFiles}
 * allows, symlinks kept as links only when they point inside `src`. Returns the tree hash and the skipped paths.
 */
function stageTree(work: string, src: string, lock?: LockSource): { tree: string; skipped: string[] } {
  src = realpathSync(src);
  git(work, ["init", "-q", "-b", "main"]);
  const gd = ["--literal-pathspecs", "--git-dir", join(work, ".git"), "--work-tree", src];
  const { files, skipped } = projectFiles(src);
  const list = join(work, "files");
  writeFileSync(list, files.join("\0"));
  if (files.length) git(work, [...gd, "add", "-f", "--pathspec-from-file", list, "--pathspec-file-nul"]);
  if (lock) stageLock(work, lock);
  return { tree: git(work, ["--git-dir", join(work, ".git"), "write-tree"]), skipped };
}

/** Where a seeded app's files came from: the template and the scaffold source commit. */
export interface LockSource { template: string; scaffoldCommit: string }

/** The app repo's template lock (`.artyfact/template.json`, read by the platform's template upgrade). */
export const TEMPLATE_LOCK = ".artyfact/template.json";

/**
 * Add `.artyfact/template.json` to the scratch index: the template and scaffold commit, and the git blob id of every
 * regular file staged from the scaffold, so a later upgrade can tell files the app left alone from files it edited.
 */
function stageLock(work: string, lock: LockSource): void {
  const gd = ["--git-dir", join(work, ".git")];
  const files: Record<string, string> = {};
  for (const line of git(work, [...gd, "ls-files", "-s", "-z"]).split("\0").filter(Boolean)) {
    const m = /^(\d+) ([0-9a-f]{40}) \d+\t(.+)$/s.exec(line);
    if (m && (m[1] === "100644" || m[1] === "100755")) files[m[3]!] = m[2]!;
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const file = join(work, "template.json");
  writeFileSync(file, `${JSON.stringify({ template: lock.template, scaffoldCommit: lock.scaffoldCommit, files: sorted }, null, 2)}\n`);
  const blob = git(work, [...gd, "hash-object", "-w", "--", file]);
  git(work, [...gd, "update-index", "--add", "--cacheinfo", `100644,${blob},${TEMPLATE_LOCK}`]);
}

interface StateFile { pushed: Record<string, string> }

function readState(file: string): StateFile {
  try {
    const s = JSON.parse(readFileSync(file, "utf8")) as StateFile;
    return { pushed: s.pushed ?? {} };
  } catch {
    return { pushed: {} };
  }
}

function writeState(file: string, s: StateFile) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(s, null, 2)}\n`);
}

export type PushResult = { head: string; action: "pushed" | "unchanged" | "created" };

/**
 * Make `repo`'s `main` hold the tree of `src`, never rewriting history: an empty repo gets a root commit; a repo whose
 * head already has this tree is left alone; otherwise a commit on top of the head is pushed, but only when that head
 * is the one this checkout last pushed (or `owned`/`adopt`), so foreign history is never silently built over.
 */
function pushTree(
  ctx: { io: InitIo; cloud: Cloud; ns: string; state: StateFile; key: string },
  repo: string, src: string, message: string, opts: { owned?: boolean; adopt?: boolean; lock?: LockSource } = {},
): PushResult {
  const r: Remote = { url: ctx.cloud.remote(ctx.ns, repo), token: ctx.cloud.token(ctx.ns, repo, "write") };
  const work = mkdtempSync(join(tmpdir(), "artyfact-init-"));
  try {
    const { tree, skipped } = stageTree(work, src, opts.lock);
    for (const p of skipped) ctx.io.out(`  skipped ${p} (absolute or outside symlink, or a path outside ${src})`);
    const head = lsRemoteHead(work, r);
    const gd = ["--git-dir", join(work, ".git")];
    if (head) {
      // No detached auto-maintenance: it would still be writing into the scratch repo when it is removed.
      git(work, ["-c", "maintenance.auto=false", "-c", "gc.auto=0", ...gd, "fetch", "-q", "--depth=1", "--", r.url, "refs/heads/main"], r.token);
      const remoteTree = git(work, [...gd, "rev-parse", "FETCH_HEAD^{tree}"]);
      if (remoteTree === tree) {
        ctx.state.pushed[ctx.key + repo] = head;
        return { head, action: "unchanged" };
      }
      if (!opts.owned && !opts.adopt && ctx.state.pushed[ctx.key + repo] !== head) {
        throw new CliError(`${repo} has commits this checkout did not push (head ${head.slice(0, 7)}) and its tree differs from ${src}.
init never builds over unknown history: merge that history into your project first, or re-run with --adopt to commit your project on top of ${head.slice(0, 7)} (a fast-forward).`);
      }
    }
    const commit = git(work, [...IDENTITY, ...gd, "commit-tree", tree, ...(head ? ["-p", head] : []), "-m", message]);
    try {
      git(work, [...gd, "push", "-q", "--", r.url, `${commit}:refs/heads/main`], r.token);
    } catch (e) {
      throw new CliError(`push to ${repo} was rejected (main moved while init ran, or the push is not a fast-forward); re-run init. ${(e as Error).message}`);
    }
    ctx.state.pushed[ctx.key + repo] = commit;
    return { head: commit, action: head ? "pushed" : "created" };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Shallow clone of `repo`'s main into a temp dir (read token via env). */
function cloneShallow(cloud: Cloud, ns: string, repo: string): { dir: string; head: string; cleanup: () => void } {
  const r: Remote = { url: cloud.remote(ns, repo), token: cloud.token(ns, repo, "read") };
  const parent = mkdtempSync(join(tmpdir(), "artyfact-clone-"));
  const dir = join(parent, "repo");
  git(parent, ["clone", "-q", "--depth=1", "--", r.url, dir], r.token);
  return { dir, head: git(dir, ["rev-parse", "HEAD"]), cleanup: () => rmSync(parent, { recursive: true, force: true }) };
}

function ensureRepo(io: InitIo, cloud: Cloud, ns: string, repo: string) {
  if (cloud.repoExists(ns, repo)) return;
  cloud.createRepo(ns, repo);
  io.out(`  created repo ${repo}`);
}

// ------------------------------------------------------------------ platform repo

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** Files under `dir`, without following symlinks (a link is an entry). */
function walk(dir: string, base = dir): string[] {
  return readdirSync(dir).sort().flatMap((n) => {
    const p = join(dir, n);
    return lstatSync(p).isDirectory() ? walk(p, base) : [relative(base, p)];
  });
}

/** Copy the project files of `src` (same selection as a push, symlinks never followed out of it) into `dst`. */
function copyProject(src: string, dst: string) {
  copyFiles(src, projectFiles(src).files, dst);
}

/**
 * Lay out the `platform` repo content from the checkout: `templates/{system,thing}/<name>@<v>/`, Thing scaffolds under
 * `scaffold/` (from scaffold.yaml `bundle`), rule packs at `templates/rule-packs/<id>@<v>/pack.dl`, README, manifest.
 */
export function buildPlatformTree(root: string, out: string): { bundleHash: string; templates: string[]; packs: string[] } {
  root = realDir("checkout", root);
  const tpl = join(root, "packages", "templates");
  const templates: string[] = [], packs: string[] = [];
  for (const kind of ["system", "thing"] as const) {
    const kdir = join(tpl, kind);
    if (!existsSync(kdir)) continue;
    for (const nameVer of readdirSync(kdir).sort()) {
      const src = join(kdir, nameVer);
      if (!existsSync(join(src, "template.yaml"))) continue;
      const ref = assertTemplateRef(`template.${kind}.${nameVer}`);
      const dst = join(out, platformTemplateDir(ref)!);
      mkdirSync(dst, { recursive: true });
      for (const f of readdirSync(src).sort()) if (f.endsWith(".yaml")) cpSync(join(src, f), join(dst, f));
      const scaffold = existsSync(join(src, "scaffold.yaml")) ? flatYaml(readFileSync(join(src, "scaffold.yaml"), "utf8")) : {};
      if (scaffold.bundle) {
        copyProject(realSubdir(`${ref} scaffold bundle`, root, scaffold.bundle), join(dst, "scaffold"));
      }
      templates.push(ref);
    }
  }
  const pdir = join(tpl, "rule-packs");
  for (const f of existsSync(pdir) ? readdirSync(pdir).sort() : []) {
    if (!f.endsWith(".dl")) continue;
    const idVer = f.slice(0, -3);
    mkdirSync(join(out, "templates", "rule-packs", idVer), { recursive: true });
    cpSync(join(pdir, f), join(out, "templates", "rule-packs", idVer, "pack.dl"));
    packs.push(idVer);
  }
  writeFileSync(join(out, "README.md"), `# platform

Templates and rule packs of this artyfact deployment, written by \`npx artyfact platform-sync\`.
Systems in this namespace pin them in their root \`node.yaml\`; the platform records this repo's commit as provenance
on every System commit. Evaluation still runs the copies bundled into the platform Worker.

- \`templates/system/<name>@<v>/\`, \`templates/thing/<name>@<v>/\` (a Thing's \`scaffold/\` seeds new app repos)
- \`templates/rule-packs/<id>@<v>/pack.dl\`
- \`manifest.json\`: \`{version, bundleHash}\`

Templates: ${templates.join(", ")}
Rule packs: ${packs.join(", ")}
`);
  const files = walk(out).filter((p) => p !== "manifest.json");
  const content = (p: string) => (lstatSync(join(out, p)).isSymbolicLink() ? `link:${readlinkSync(join(out, p))}` : readFileSync(join(out, p)));
  const bundleHash = sha256(files.map((p) => `${p}\0${sha256(content(p))}\n`).join(""));
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify({ version: 1, bundleHash }, null, 2)}\n`);
  return { bundleHash, templates, packs };
}

interface Ctx { io: InitIo; cloud: Cloud; ns: string; state: StateFile; key: string }

/** `init` writes `platform` only when it is missing or empty; updates are `platform-sync`'s job (never an older checkout's). */
function initPlatform(c: Ctx): void {
  const head = c.cloud.repoExists(c.ns, PLATFORM_REPO)
    ? lsRemoteHead(c.io.cwd, { url: c.cloud.remote(c.ns, PLATFORM_REPO), token: c.cloud.token(c.ns, PLATFORM_REPO, "read") })
    : "";
  if (head) {
    c.io.out(`${PLATFORM_REPO}: exists at ${head.slice(0, 12)}, left alone (update it with 'npx artyfact platform-sync --namespace ${c.ns}')`);
    return;
  }
  const plat = syncPlatform(c);
  c.io.out(`${PLATFORM_REPO}: ${plat.action} at ${plat.head.slice(0, 12)}`);
}

function syncPlatform(c: Ctx): PushResult & { bundleHash: string } {
  ensureRepo(c.io, c.cloud, c.ns, PLATFORM_REPO);
  const out = mkdtempSync(join(tmpdir(), "artyfact-platform-"));
  try {
    const built = buildPlatformTree(c.io.root ?? defaultRoot(), out);
    const res = pushTree(c, PLATFORM_REPO, out, `platform-sync ${built.bundleHash.slice(0, 12)}`, { owned: true });
    return { ...res, bundleHash: built.bundleHash };
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ commands

function namespaceOf(values: Record<string, unknown>, io: InitIo): string {
  const ns = (values.namespace as string | undefined) ?? io.env.ARTIFACTS_NAMESPACE ?? DEFAULT_NAMESPACE;
  return assertName("namespace", ns);
}

function connect(io: InitIo, ns: string): Cloud {
  const cloud = io.cloud ?? cloudCli(spawnExec(io.root ?? defaultRoot()), io.env);
  const account = cloud.account();
  io.out(`account ${account.slice(0, 8)}… (wrangler and cf agree)`);
  io.out(`namespace ${ns}: ${cloud.ensureNamespace(ns)}`);
  return cloud;
}

const stateFileFor = (io: InitIo, project: string) => join(project, ".artyfact", "init.json");

export async function platformSyncCommand(args: string[], io: InitIo): Promise<number> {
  const values = parse(args, { namespace: { type: "string" } });
  const ns = namespaceOf(values, io);
  const cloud = connect(io, ns);
  return withAccountScrubbed(cloud, async () => {
    const res = syncPlatform({ io, cloud, ns, state: { pushed: {} }, key: "" });
    io.out(`${PLATFORM_REPO}: ${res.action} at ${res.head.slice(0, 12)} (bundle ${res.bundleHash.slice(0, 12)})`);
    return 0;
  });
}

export async function initCommand(args: string[], io: InitIo): Promise<number> {
  const values = parse(args, {
    dir: { type: "string" }, genome: { type: "string" }, app: { type: "string" }, platform: { type: "string" },
    namespace: { type: "string" }, "from-template": { type: "string" }, force: { type: "boolean" }, adopt: { type: "boolean" },
    "genome-only": { type: "boolean" }, "no-review": { type: "boolean" }, "integrity-run": { type: "string" },
    "integrity-unreviewed-reason": { type: "string" },
  });
  const integrityRunId = values["integrity-run"] as string | undefined;
  const rawUnreviewedReason = values["integrity-unreviewed-reason"] as string | undefined;
  if (integrityRunId !== undefined && rawUnreviewedReason !== undefined) {
    throw new CliError("--integrity-run and --integrity-unreviewed-reason are mutually exclusive");
  }
  const integrityUnreviewedReason = rawUnreviewedReason?.trim();
  if (rawUnreviewedReason !== undefined && (!integrityUnreviewedReason || integrityUnreviewedReason.length > 500)) {
    throw new CliError("--integrity-unreviewed-reason must be 1 to 500 characters after trimming");
  }
  // --genome-only pushes the Genome and re-imports; the app repo is never read from disk, pushed or seeded (the platform
  // keeps its head and recorded scaffold source). For migrating a deployed System's Genome (docs/deploy.md).
  const genomeOnly = values["genome-only"] === true;
  if (genomeOnly && (values.app !== undefined || values["from-template"] !== undefined)) throw new CliError("--genome-only never pushes an app; drop --app/--from-template");
  // Every path is resolved with realpath. Defaults (`<dir>/system`, `<dir>/app`) must stay inside the project; an
  // explicitly given --genome/--app directory is its own root. Nothing outside these roots is read or pushed.
  const dirArg = resolve(io.cwd, (values.dir as string | undefined) ?? ".");
  if (!existsSync(dirArg)) {
    // With --genome the project dir only holds init's state; otherwise there is nothing to read.
    if (values.genome === undefined) throw new CliError(`no ${NODE_FILE} in ${join(dirArg, "genome")}; pass --dir <project> (with genome/) or --genome <dir>`);
    mkdirSync(dirArg, { recursive: true });
  }
  const project = realDir("--dir", dirArg);
  const genomeDir = values.genome !== undefined
    ? realDir("--genome", resolve(io.cwd, values.genome as string))
    : (existsSync(join(project, "genome")) ? realDir("genome dir", join(project, "genome"), project) : join(project, "genome"));
  const appGiven = values.app !== undefined;
  const appPath = appGiven ? resolve(io.cwd, values.app as string) : join(project, "app");
  const appDir = existsSync(appPath) ? realDir(appGiven ? "--app" : "app dir", appPath, appGiven ? undefined : project) : appPath;
  const fromTemplate = values["from-template"] === undefined ? undefined : assertTemplateRef(values["from-template"]);
  const ns = namespaceOf(values, io);

  const rootFile = join(genomeDir, NODE_FILE);
  if (!existsSync(rootFile)) {
    if (existsSync(join(genomeDir, V1_ROOT_FILE))) throw new CliError(`${genomeDir} is a v1 Genome; convert it first with artyfact convert-genome`);
    throw new CliError(`no ${NODE_FILE} in ${genomeDir}; pass --dir <project> (with genome/) or --genome <dir>`);
  }
  if (!isInside(genomeDir, realpathSync(rootFile))) throw new CliError(`${NODE_FILE} in ${genomeDir} resolves outside it`);
  const systemId = assertSystemId(systemIdOf(readFileSync(rootFile, "utf8")));
  const appArtifacts = appArtifactIds(genomeDir);
  const appNeeded = appArtifacts.length > 0;
  const names = systemRepoNames(systemId, appArtifacts);
  assertName("genome repo", names.genomeRepo);
  if (appNeeded) assertName("app repo", names.appRepo);
  const hasApp = !genomeOnly && (existsSync(join(appDir, "package.json")) || (existsSync(appDir) && readdirSync(appDir).length > 0));
  if (hasApp && fromTemplate) throw new CliError(`--from-template seeds a project without an app, but ${appDir} exists`);
  if (!appNeeded && (hasApp || fromTemplate)) throw new CliError("this Genome has no worker-fullstack artifact; remove --app/--from-template or add the artifact binding first");
  io.out(`${systemId} -> ${names.genomeRepo}${appNeeded ? `, ${names.appRepo}` : ""} (namespace ${ns})`);
  // Resolved before anything is pushed. When the admin token will be sent, an explicit URL or a local platform that
  // identifies itself is required, else stop here. Without the token nothing is sent: the printed import line falls back
  // to the default URL.
  const sendsBearer = !!io.env.ARTYFACT_ADMIN_TOKEN;
  const platformUrl = await resolvePlatform(values.platform as string | undefined, io.env, io.fetch ?? fetch, io.err, sendsBearer ? undefined : DEFAULT_URL);

  const cloud = connect(io, ns);
  return withAccountScrubbed(cloud, () => initWith(io, { project, genomeDir, appDir, hasApp, appNeeded, fromTemplate, ns, systemId, names, cloud, platformUrl, force: values.force === true, adopt: values.adopt === true, genomeOnly, noReview: values["no-review"] === true, integrityRunId, integrityUnreviewedReason }));
}

/** CLI errors name the account by its prefix only (git and wrangler failures can echo remote URLs holding the id). */
async function withAccountScrubbed<T>(cloud: Cloud, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const id = cloud.accountId?.();
    if (id && e instanceof Error) e.message = e.message.replaceAll(id, `${id.slice(0, 8)}…`);
    throw e;
  }
}

interface InitPlan {
  project: string; genomeDir: string; appDir: string; hasApp: boolean; appNeeded: boolean; fromTemplate: string | undefined; ns: string; systemId: string;
  names: ReturnType<typeof systemRepoNames>; cloud: Cloud; platformUrl: string; force: boolean; adopt: boolean; genomeOnly: boolean; noReview: boolean;
  integrityRunId?: string;
  integrityUnreviewedReason?: string;
}

async function initWith(io: InitIo, plan: InitPlan): Promise<number> {
  const { project, genomeDir, appDir, hasApp, appNeeded, fromTemplate, ns, systemId, names, cloud, platformUrl, force, adopt, genomeOnly, noReview, integrityRunId, integrityUnreviewedReason } = plan;
  const stateFile = stateFileFor(io, project);
  const state = readState(stateFile);
  const key = `${cloud.remote(ns, "").replace(/\.git$/, "")}`;
  const ctx: Ctx = { io, cloud, ns, state, key };
  try {
    initPlatform(ctx);

    ensureRepo(io, cloud, ns, names.genomeRepo);
    const genome = pushTree(ctx, names.genomeRepo, genomeDir, `Import ${systemId} Genome`, { adopt });
    io.out(`${names.genomeRepo}: ${genome.action} at ${genome.head.slice(0, 12)}`);

    let scaffoldFrom: { repo: string; commit: string; path?: string } | undefined;
    if (!appNeeded) {
      // Genome-only Systems intentionally have no application repository or synthetic source.
    } else if (genomeOnly) {
      if (!cloud.repoExists(ns, names.appRepo)) throw new CliError(`--genome-only needs the existing ${names.appRepo}; it does not exist in ${ns}`);
      io.out(`${names.appRepo}: left alone (--genome-only)`);
    } else if (hasApp) {
      ensureRepo(io, cloud, ns, names.appRepo);
      const app = pushTree(ctx, names.appRepo, appDir, `Import ${systemId} app`, { adopt });
      io.out(`${names.appRepo}: ${app.action} at ${app.head.slice(0, 12)}`);
    } else if (fromTemplate) {
      scaffoldFrom = await seedFromTemplate(ctx, fromTemplate, names.appRepo);
    } else {
      // A re-run of a template-seeded project: the app lives only in its repo. The platform keeps the recorded scaffoldFrom.
      const head = cloud.repoExists(ns, names.appRepo) ? lsRemoteHead(io.cwd, { url: cloud.remote(ns, names.appRepo), token: cloud.token(ns, names.appRepo, "read") }) : "";
      if (!head) throw new CliError(`no app in ${appDir} and ${names.appRepo} has no commits; pass --app <dir>, or --from-template <template.thing.id@version> to seed it`);
      io.out(`${names.appRepo}: no local app; using its head ${head.slice(0, 12)}`);
    }

    if (integrityUnreviewedReason) io.out("integrity: unreviewed import requested; full integrity check and agreement remain pending");
    return await importIntoPlatform(io, platformUrl, { systemId, genomeRepo: names.genomeRepo, ...(appNeeded && { appRepo: names.appRepo }), ...(scaffoldFrom && { scaffoldFrom }), ...(noReview && { review: false }), ...(integrityRunId && { integrityRunId }), ...(integrityUnreviewedReason && { integrityUnreviewedReason }) }, force);
  } finally {
    writeState(stateFile, state);
  }
}

/**
 * Seed `<slug>.app` from a Thing template's scaffold (read from `platform`): fork a whole repo, or copy a subtree and push.
 * Returns the scaffold source to record on the app binding, or undefined when the app repo already has history.
 */
async function seedFromTemplate(c: Ctx, ref: string, appRepo: string): Promise<{ repo: string; commit: string; path?: string } | undefined> {
  const dir = platformTemplateDir(ref);
  assertTemplateRef(ref);
  if (!dir || !ref.startsWith("template.thing.")) throw new CliError(`--from-template takes a Thing template ref like template.thing.cloudflare-worker-webapp@1, not ${ref}`);
  if (c.cloud.repoExists(c.ns, appRepo)) {
    const r: Remote = { url: c.cloud.remote(c.ns, appRepo), token: c.cloud.token(c.ns, appRepo, "read") };
    const head = lsRemoteHead(c.io.cwd, r);
    if (head) {
      c.io.out(`${appRepo}: already has history at ${head.slice(0, 12)}; not re-seeding`);
      return undefined;
    }
  }
  const plat = cloneShallow(c.cloud, c.ns, PLATFORM_REPO);
  try {
    const file = join(plat.dir, dir, "scaffold.yaml");
    if (!existsSync(file)) throw new CliError(`${PLATFORM_REPO} has no ${dir}/scaffold.yaml; run 'npx artyfact platform-sync' or pick another template`);
    const sc = flatYaml(readFileSync(file, "utf8"));
    const repo = assertName("scaffold repo", sc.repo ?? PLATFORM_REPO);
    const path = sc.path?.replace(/\/+$/g, "") || undefined;
    if (!path) {
      // Whole repo: an Artifacts fork keeps its history (another System's `<slug>.app` works the same way).
      if (c.cloud.repoExists(c.ns, appRepo)) throw new CliError(`${appRepo} exists (empty); a whole-repo scaffold needs to fork into a new repo. Remove it or use a path scaffold.`);
      const srcHead = lsRemoteHead(c.io.cwd, { url: c.cloud.remote(c.ns, repo), token: c.cloud.token(c.ns, repo, "read") });
      if (!srcHead) throw new CliError(`scaffold repo ${repo} has no commits`);
      c.cloud.fork(c.ns, repo, appRepo);
      const head = await waitForHead(c, appRepo);
      c.io.out(`${appRepo}: forked from ${repo}@${srcHead.slice(0, 12)}`);
      return { repo, commit: head };
    }
    const source = repo === PLATFORM_REPO ? plat : cloneShallow(c.cloud, c.ns, repo);
    try {
      const sub = realSubdir(`${repo}@${source.head.slice(0, 7)} scaffold path`, realpathSync(source.dir), path);
      ensureRepo(c.io, c.cloud, c.ns, appRepo);
      const lock = { template: dir.slice("templates/".length), scaffoldCommit: source.head };
      const res = pushTree(c, appRepo, sub, `Seed from ${ref} (${repo}:${path}@${source.head.slice(0, 7)})`, { lock });
      c.io.out(`${appRepo}: seeded from ${repo}:${path}@${source.head.slice(0, 12)} at ${res.head.slice(0, 12)}`);
      return { repo, commit: source.head, path };
    } finally {
      if (source !== plat) source.cleanup();
    }
  } finally {
    plat.cleanup();
  }
}

async function waitForHead(c: Ctx, repo: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const head = lsRemoteHead(c.io.cwd, { url: c.cloud.remote(c.ns, repo), token: c.cloud.token(c.ns, repo, "read") });
      if (head) return head;
    } catch {
      /* fork still in progress */
    }
    if (Date.now() > deadline) throw new CliError(`fork ${repo} not readable after 30 s`);
    await new Promise((r) => setTimeout(r, c.io.pollMs ?? 1000));
  }
}

const shellSingleQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;

async function importIntoPlatform(io: InitIo, base: string, body: Record<string, unknown>, force: boolean): Promise<number> {
  const url = `${base}/api/systems/import`;
  const payload = JSON.stringify({ ...body, force });
  const admin = io.env.ARTYFACT_ADMIN_TOKEN;
  if (!admin) {
    io.out("");
    io.out("ARTYFACT_ADMIN_TOKEN is not set, so the System was not imported. Import it with:");
    io.out(`  curl -sS -XPOST ${url} -H "authorization: Bearer $ARTYFACT_ADMIN_TOKEN" -H 'content-type: application/json' -d ${shellSingleQuote(payload)}`);
    return 0;
  }
  assertBearerTransport(base, "ARTYFACT_ADMIN_TOKEN");
  let res: Response;
  try {
    res = await (io.fetch ?? fetch)(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${admin}` }, body: payload });
  } catch (e) {
    throw new CliError(`cannot reach the platform at ${base}: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: { head?: string; system?: { importReview?: { status?: string } }; warnings?: { rule: string; subject?: string; message: string }[]; error?: { code?: string; message?: string } } = {};
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (res.status === 409 && json.error?.code === "already-imported") {
    throw new CliError(`${json.error.message ?? "already imported from other commits"}\nRe-run with --force to re-point ${body.systemId} at these commits.`);
  }
  if (!res.ok) throw new CliError(`import failed: ${res.status} ${json.error ? `${json.error.code}: ${json.error.message}` : text.slice(0, 200)}`);
  io.out(`imported ${body.systemId} at ${json.head}`);
  for (const w of json.warnings ?? []) io.out(`  warning ${w.rule}${w.subject ? ` (${w.subject})` : ""}: ${w.message}`);
  const sid = encodeURIComponent(String(body.systemId));
  io.out(`System: ${base}/s/${sid}/r/head/overview`);
  if (json.system?.importReview?.status === "pending") {
    const note = body.integrityUnreviewedReason
      ? "full integrity check and agreement are required; --no-review does not clear this integrity review"
      : "work is refused until it is accepted; re-run with --no-review to skip";
    io.out(`review: pending, open ${base}/s/${sid}/r/head/review?panel=import (${note})`);
  }
  return 0;
}
