import { startLifecycleTask, submitLifecycleTask } from './lifecycle-service';
import { pushCommit } from './git/push';
import { remoteUrl } from './artifacts/client';
/**
 * App template upgrades: bring later changes of a Thing template's scaffold into an existing app repo. The plan compares
 * git blob ids of the current scaffold, the app at a ref and the app's `.artyfact/template.json` lock (what the
 * template shipped last time). Applying it is an ordinary gated change: a new Evolution, an editor-origin realization
 * and a commit through `commitEdit`, so the result is a candidate with hooks and a CI preview, promoted like any other.
 */
import { isSecretFile, neverStaged } from "artyfact/ignore";
import { PLATFORM_REPO, isName, platformTemplateDir } from "artyfact/naming";
import { parse as parseYaml } from "yaml";
import type {
  TemplateLock, TemplateUpgradeFile, TemplateUpgradeNoScaffold, TemplateUpgradePlan, TemplateUpgradeRequest, TemplateUpgradeResponse,
} from "../shared/api";
import { artifactsErrorCode, artifactsFor, withRepo, type ArtifactsRepoLike, type TreeEntry } from "./artifacts/client";
import { listTree } from "./artifacts/genome-source";
import { resolveRef } from "./compare";
import { gitTransport, MAX_CHANGES, sniffBinary } from "./editor";
import { badRequest, conflict, HttpError, notFound, unprocessable } from "./errors";
import { appThing, genomeAt, systemStub } from "./service";

export const LOCK_PATH = ".artyfact/template.json";
export const UPGRADE_AGENT = "human:template-upgrade";

const README_RE = /^readme(\..*)?$/i;
const NEVER_DIRS = new Set([".git", ".artyfact", "dist"]);
const NEVER_FILES = new Set([".artyfact.json", ".DS_Store"]);

/**
 * Paths an upgrade never touches, whatever the template ships: READMEs (always app-owned), secret files, dependency
 * and build output, and the CLI's own state (the same rules `artyfact init` and `submit` apply). The lock itself is
 * written by the upgrade, never compared.
 */
export function appOwned(path: string): boolean {
  const parts = path.split("/");
  const base = parts.at(-1)!;
  return README_RE.test(base) || isSecretFile(base) || neverStaged(path) || parts.slice(0, -1).some((p) => NEVER_DIRS.has(p))
    || NEVER_FILES.has(base) || base.endsWith(".tsbuildinfo");
}

/** Files the template ships: plain and executable blobs only (symlinks and submodules are left to the app). */
const shipped = (e: TreeEntry) => e.type === "blob" || e.type === "exec";

/** A lock that parses and has the expected shape, else null (an unreadable lock is treated as no lock). */
export function parseLock(text: string | null | undefined): TemplateLock | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<TemplateLock>;
    if (typeof v?.template !== "string" || typeof v.scaffoldCommit !== "string" || !v.files || typeof v.files !== "object") return null;
    const files: Record<string, string> = {};
    for (const [p, h] of Object.entries(v.files)) if (typeof h === "string") files[p] = h;
    return { template: v.template, scaffoldCommit: v.scaffoldCommit, files };
  } catch {
    return null;
  }
}

export function lockText(lock: TemplateLock): string {
  const files = Object.fromEntries(Object.entries(lock.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${JSON.stringify({ template: lock.template, scaffoldCommit: lock.scaffoldCommit, files }, null, 2)}\n`;
}

/**
 * The per-path decision, over the union of template and lock paths (app-owned paths never appear). `t`, `a`, `l` are
 * the template, app and lock blob ids (undefined = absent). A path the template has not changed since the lock is
 * omitted whatever the app did to it: that is the app's own work, and nothing in the template asks to replace it.
 */
export function decide(path: string, t: string | undefined, a: string | undefined, l: string | undefined, locked: boolean): TemplateUpgradeFile | null {
  if (a === t) return null;
  if (l !== undefined && t === l) return null;
  if (t !== undefined && a === undefined) {
    return l === undefined
      ? { path, action: "add", reason: "new in the template" }
      : { path, action: "conflict", reason: "the app deleted it, and the template has changed it since" };
  }
  if (t !== undefined) {
    if (l !== undefined && a === l) return { path, action: "update", reason: "unchanged by the app since it was scaffolded; the template changed it" };
    return {
      path, action: "conflict",
      reason: !locked ? "no template lock, so whether the app edited it is unknown; it differs from the template"
        : l === undefined ? "the app has its own file at a path the template now ships"
        : "the app edited it, and the template changed it too",
    };
  }
  // Dropped by the template (only lock paths reach here).
  if (a === l) return { path, action: "remove", reason: "the template no longer ships it, and the app did not edit it" };
  return { path, action: "conflict", reason: "the template no longer ships it, but the app edited it" };
}

const ORDER = { add: 0, update: 1, remove: 2, conflict: 3 } as const;

/** Pure plan over three listings (path → blob id); exported for tests. */
export function planFiles(template: Map<string, string>, app: Map<string, string>, lock: TemplateLock | null): TemplateUpgradeFile[] {
  const paths = new Set([...template.keys(), ...Object.keys(lock?.files ?? {})]);
  const out: TemplateUpgradeFile[] = [];
  for (const p of paths) {
    if (appOwned(p) || p === LOCK_PATH) continue;
    const d = decide(p, template.get(p), app.get(p), lock?.files[p], !!lock);
    if (d) out.push(d);
  }
  return out.sort((x, y) => ORDER[x.action] - ORDER[y.action] || (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

/** The lock records exactly the template's files (app-owned paths, which the CLI's lock may list, do not count). */
function sameFiles(lock: Record<string, string>, template: Map<string, string>): boolean {
  const own = Object.entries(lock).filter(([p]) => !appOwned(p) && p !== LOCK_PATH);
  return own.length === template.size && own.every(([p, h]) => template.get(p) === h);
}

// ------------------------------------------------------------------ reading the template

interface Scaffold {
  template: string;
  repo: string;
  path: string;
  commit: string;
  /** path (relative to the scaffold root) → entry, app-owned paths removed. */
  files: Map<string, TreeEntry>;
}

const missing = (e: unknown) => artifactsErrorCode(e) === "NOT_FOUND";

/** `thing/<name>@<v>` from a lock, else from the app Thing's `templateRef` in the canonical Genome. */
async function templateOf(env: Env, systemId: string, lock: TemplateLock | null): Promise<string> {
  if (lock && /^thing\/[\w.-]+@[\w.-]+$/.test(lock.template) && !lock.template.includes("..")) return lock.template;
  const s = await systemStub(env, systemId).state();
  if (!s) throw notFound(`system ${systemId} is not imported`);
  const m = (await genomeAt(env, systemId, s.genomeCommit, s.genomeSource)).model;
  const thing = appThing(m);
  const dir = thing?.templateRef ? platformTemplateDir(thing.templateRef) : undefined;
  if (!dir || !dir.startsWith("templates/thing/")) {
    throw unprocessable("no-app-template", `the app Thing ${thing?.id ?? "(none)"} has no Thing template to upgrade from`);
  }
  return dir.slice("templates/".length);
}

/** The scaffold `scaffold.yaml` names, read from `platform`'s head (and the scaffold repo's head, when it is another repo). */
async function readScaffold(env: Env, template: string): Promise<Scaffold | TemplateUpgradeNoScaffold> {
  const ns = artifactsFor(env);
  const yamlPath = `templates/${template}/scaffold.yaml`;
  const plat = await withRepo(ns, PLATFORM_REPO, async (r) => {
    const [head] = await r.log({ limit: 1 });
    if (!head) return null;
    const blob = await r.readFile({ ref: head.hash, path: yamlPath }).catch((e: unknown) => (missing(e) ? null : Promise.reject(e)));
    const hasTemplate = !blob && !!(await r.readFile({ ref: head.hash, path: `templates/${template}/template.yaml` }).catch((e: unknown) => (missing(e) ? null : Promise.reject(e))));
    return { head: head.hash, text: blob ? await blob.text() : null, hasTemplate };
  }).catch((e: unknown) => (missing(e) ? null : Promise.reject(e)));
  if (!plat) throw unprocessable("platform-unsynced", `no '${PLATFORM_REPO}' repo (or it is empty); run 'npx artyfact platform-sync'`);
  // A Thing template that ships no scaffold (a library or service template) has nothing to upgrade from.
  if (plat.text === null && plat.hasTemplate) return { status: "no-scaffold", template };
  if (plat.text === null) {
    throw unprocessable("template-not-in-platform", `${PLATFORM_REPO}@${plat.head.slice(0, 7)} has no ${yamlPath}; run 'npx artyfact platform-sync'`);
  }
  let sc: { repo?: unknown; path?: unknown };
  try {
    sc = (parseYaml(plat.text) as typeof sc) ?? {};
  } catch {
    throw unprocessable("invalid-scaffold", `${yamlPath} in ${PLATFORM_REPO} is not valid YAML`);
  }
  const repo = sc.repo === undefined ? PLATFORM_REPO : sc.repo;
  const path = typeof sc.path === "string" ? sc.path.replace(/^\/+|\/+$/g, "") : "";
  if (!isName(repo) || path.split("/").includes("..")) throw unprocessable("invalid-scaffold", `${yamlPath} names an invalid scaffold repo or path`);
  const read = async (r: ArtifactsRepoLike, commit: string) => {
    const listing = await listTree(r, commit, path);
    if (!listing.size) throw unprocessable("template-not-in-platform", `${repo}@${commit.slice(0, 7)} has no scaffold files under ${path || "/"}`);
    return new Map([...listing].filter(([p, e]) => shipped(e) && !appOwned(p) && p !== LOCK_PATH));
  };
  if (repo === PLATFORM_REPO) {
    return { template, repo, path, commit: plat.head, files: await withRepo(ns, repo, (r) => read(r, plat.head)) };
  }
  return withRepo(ns, repo, async (r) => {
    const [head] = await r.log({ limit: 1 });
    if (!head) throw unprocessable("empty-repo", `scaffold repo ${repo} has no commits`);
    return { template, repo, path, commit: head.hash, files: await read(r, head.hash) };
  });
}

// ------------------------------------------------------------------ plan

interface Planned { plan: TemplateUpgradePlan; scaffold: Scaffold }
const isNoScaffold = (s: object): s is TemplateUpgradeNoScaffold => "status" in s;

async function computePlan(env: Env, systemId: string, ref: string): Promise<Planned | TemplateUpgradeNoScaffold> {
  const s = await systemStub(env, systemId).state();
  if (!s) throw notFound(`system ${systemId} is not imported`);
  const app = await resolveRef(env, s, "app", ref);
  const { listing, lock } = await withRepo(artifactsFor(env), app.repo, async (r) => {
    const blob = await r.readFile({ ref: app.commit, path: LOCK_PATH });
    return { listing: await listTree(r, app.commit), lock: parseLock(blob ? await blob.text() : null) };
  });
  const scaffold = await readScaffold(env, await templateOf(env, systemId, lock));
  if (isNoScaffold(scaffold)) return scaffold;
  const tmpl = new Map([...scaffold.files].map(([p, e]) => [p, e.hash] as const));
  const files = planFiles(tmpl, new Map([...listing].map(([p, e]) => [p, e.hash] as const)), lock);
  const upToDate = files.length === 0 && !!lock && lock.template === scaffold.template && sameFiles(lock.files, tmpl);
  return {
    scaffold,
    plan: { template: scaffold.template, from: lock?.scaffoldCommit ?? null, to: scaffold.commit, upToDate, files, app: { repo: app.repo, commit: app.commit }, locked: !!lock },
  };
}

export async function templateUpgradePlan(env: Env, systemId: string, ref = "head"): Promise<TemplateUpgradePlan | TemplateUpgradeNoScaffold> {
  const planned = await computePlan(env, systemId, ref);
  return isNoScaffold(planned) ? planned : planned.plan;
}

// ------------------------------------------------------------------ apply

function includeList(body: Record<string, unknown>): string[] {
  const v = (body as TemplateUpgradeRequest).include;
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x)) throw badRequest("include must be an array of paths");
  return [...new Set(v)];
}

/** Template content of `paths`, as text; a binary template file cannot travel through the editor commit. */
async function templateTexts(env: Env, sc: Scaffold, paths: string[]): Promise<Map<string, string>> {
  return withRepo(artifactsFor(env), sc.repo, async (r) => {
    const out = new Map<string, string>();
    for (const p of paths) {
      const blob = await r.readBlob(sc.files.get(p)!.hash);
      if (!blob) throw unprocessable("missing-blob", `template file ${p} (${sc.files.get(p)!.hash.slice(0, 12)}) is missing in ${sc.repo}`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (sniffBinary(bytes)) throw unprocessable("binary-template-file", `template file ${p} is binary; copy it into the app by hand`);
      out.set(p, new TextDecoder().decode(bytes));
    }
    return out;
  });
}

/**
 * `POST /api/systems/:id/template-upgrade` (admin): apply every add, update and remove of the plan at head, plus the
 * conflicts listed in `include`, and write the new lock, as one editor commit on a new Evolution's realization.
 */
export async function applyTemplateUpgrade(env: Env, systemId: string, body: Record<string, unknown>, platformUrl: string): Promise<TemplateUpgradeResponse> {
  const include = includeList(body);
  const planned = await computePlan(env, systemId, "head");
  if (isNoScaffold(planned)) throw unprocessable("no-scaffold", `${planned.template} ships no scaffold, so there is nothing to upgrade from`);
  const { plan, scaffold } = planned;
  if (plan.upToDate) throw conflict("up-to-date", `the app already matches ${plan.template} at ${plan.to.slice(0, 12)}`);
  const conflicts = new Set(plan.files.filter((f) => f.action === "conflict").map((f) => f.path));
  const unknown = include.filter((p) => !conflicts.has(p));
  if (unknown.length) throw unprocessable("not-a-conflict", `include lists paths that are not conflicts in the plan: ${unknown.join(", ")}`);
  const applied = plan.files.filter((f) => f.action !== "conflict" || include.includes(f.path));
  if (applied.length + 1 > MAX_CHANGES) {
    throw unprocessable("too-many-changes", `the upgrade changes ${applied.length + 1} files; one commit takes at most ${MAX_CHANGES}`);
  }
  const writes = applied.filter((f) => scaffold.files.has(f.path)).map((f) => f.path);
  const texts = await templateTexts(env, scaffold, writes);
  const lock: TemplateLock = {
    template: plan.template, scaffoldCommit: plan.to, files: Object.fromEntries([...scaffold.files].map(([p, e]) => [p, e.hash])),
  };
  const changes = [
    ...applied.map((f) => ({ path: f.path, content: texts.get(f.path) ?? null })),
    { path: LOCK_PATH, content: lockText(lock) },
  ];
  const short = plan.to.slice(0, 7);
  const list = (a: string) => plan.files.filter((f) => f.action === a && (a !== "conflict" || include.includes(f.path))).map((f) => f.path);
  const summary = (["add", "update", "remove", "conflict"] as const).flatMap((a) => (list(a).length ? [`${a === "conflict" ? "overwrite" : a}: ${list(a).join(", ")}`] : []));
  const skipped = [...conflicts].filter((p) => !include.includes(p));
  const intent = [
    `Bring the app repo up to ${plan.template} at ${scaffold.repo}@${short}${plan.from ? ` (from ${plan.from.slice(0, 7)})` : " (no template lock before)"}.`,
    ...summary,
    ...(skipped.length ? [`kept the app's version: ${skipped.join(", ")}`] : []),
    `Records the template's files in ${LOCK_PATH}.`,
  ].join("\n");

  const stub=systemStub(env,systemId),state=await stub.state();if(!state?.manifest)throw notFound('System has no accepted Genome');
  const binding=Object.entries(state.manifest.artifacts).find(([,b])=>b.repo===plan.app.repo&&b.commit===plan.app.commit);if(!binding)throw conflict('stale-base','app source moved since the template upgrade was reviewed');
  const [artifactId,source]=binding,g=await genomeAt(env,systemId,state.genomeCommit,state.genomeSource),thing=appThing(g.model);
  const taskId='template-upgrade',title=`Upgrade app template to ${short}`,checks=g.model.criteria.filter(c=>c.targetKind==='artifact'||c.targetKind==='runtime').map(c=>c.id);
  const realizationPlan=await stub.createRealizationPlan({title,genomeCommit:state.genomeCommit,expectedHead:state.head,tasks:[{id:taskId,title,artifactId,steps:[intent],dependsOn:[],readNodes:[],writeNodes:thing?[thing.id]:[g.model.system.id],checks,footprint:{repo:source.repo,artifactId,globs:changes.map(c=>c.path),paths:changes.map(c=>c.path),unmatched:[],known:true}}]});
  const started=await startLifecycleTask(env,systemId,realizationPlan.id,taskId,{agentLabel:UPGRADE_AGENT},platformUrl);
  try {
    const pushed=await withRepo(artifactsFor(env),started.task.forkRepo,r=>pushCommit({repo:r,remote:remoteUrl(env,started.task.forkRepo,started.remote),token:started.token.value,parent:started.task.model?.commit??started.task.base.commit,changes,...gitTransport(),author:{name:'template-upgrade',email:'template-upgrade@artyfact.local'},message:`Upgrade app template to ${plan.template}@${short}`}));
    const submitted=await submitLifecycleTask(env,systemId,realizationPlan.id,taskId,{attemptId:started.attempt.id,generation:started.attempt.generation,commit:pushed.commit});
    return {realizationPlan:submitted.plan,task:submitted.task,realization:(await stub.realization(started.attempt.realizationId))!.realization,candidate:submitted.candidate,plan};
  }catch(e){if(e instanceof HttpError)e.message=`${e.message} (realization plan ${realizationPlan.id}, task ${taskId} were created)`;throw e;}
}
