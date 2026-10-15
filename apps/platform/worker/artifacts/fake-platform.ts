/// <reference types="vite/client" />
/**
 * `FAKE_ARTIFACTS=1` boot mode: the whole backend without a Cloudflare account. On the first request the Worker
 * swaps Artifacts for an in-memory namespace seeded from `examples/` (Peopling), the repo-root `genome/`
 * (Artyfact itself) or both, as `FAKE_SEED` says, and `packages/templates` (the `platform` repo, so template upgrades
 * and provenance work), imports those Systems, and pushes
 * editor commits through a fake git receive-pack. The same fake git server answers `git clone`, `fetch` and `push`
 * at `/api/fake-git/<repo>.git` (see {@link FAKE_REMOTE_BASE}), so the CLI's `claim`, `start` and `submit` run against it.
 * State lives in the isolate, so a restart starts over (the Vite config turns off state persistence in this mode to
 * keep the Durable Objects in step).
 */
import { PLATFORM_REPO, systemRepoNames } from "@artyfact/cli/naming";
import { reportBuild } from "../deployments";
import { setEditorTransport } from "../editor";
import { manifestExists } from "../hooks/manifest-exists";
import { toEvaluation } from "../hooks/provenance";
import { ingestEvents } from "../phenome";
import { hooksOf } from "../promotion";
import { genomeAt, importSystem, refreshRegistry, registryStub, startWork, systemStub } from "../service";
import { buildCandidateManifest, manifestHash } from "./candidates";
import { setArtifactsOverride } from "./client";
import { FakeArtifacts } from "./fake";
import { fakeReceivePack, type FakeReceivePack } from "./fake-receive-pack";

/**
 * The remote every fake repo reports. It has the Artifacts shape the CLI accepts (`https://<host>/git/<ns>/<repo>.git`)
 * on a host that never resolves; git reaches the platform through
 * `url.http://localhost:<port>/api/fake-git/.insteadOf=https://fake.artifacts.local/git/artyfact/` and the CLI is told to
 * trust the host with `ARTYFACT_ALLOW_REMOTE_HOST=fake.artifacts.local` (docs/demo-runbook.md).
 */
export const FAKE_REMOTE_HOST = "fake.artifacts.local";
export const FAKE_REMOTE_BASE = `https://${FAKE_REMOTE_HOST}/git/artyfact`;
/** The path prefix under which the Worker serves the fake repos over Git smart HTTP. */
export const FAKE_GIT_PREFIX = "/api/fake-git/";

const strip = (files: Record<string, string>, root: string) =>
  Object.fromEntries(Object.entries(files).map(([p, t]) => [p.slice(p.indexOf(root) + root.length), t] as const));

export const exampleGenome = strip(import.meta.glob("../../../../examples/peopling-system/**/*.yaml",
  { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-system/");
export const exampleApp = strip(import.meta.glob(["../../../../examples/peopling-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"],
  { query: "?raw", import: "default", eager: true }) as Record<string, string>, "peopling-app/");
const templateYaml = strip(import.meta.glob("../../../../packages/templates/{system,thing}/*/*.yaml",
  { query: "?raw", import: "default", eager: true }) as Record<string, string>, "packages/");
const rulePacks = strip(import.meta.glob("../../../../packages/templates/rule-packs/*.dl",
  { query: "?raw", import: "default", eager: true }) as Record<string, string>, "rule-packs/");

/**
 * The `platform` repo as `artyfact platform-sync` lays it out: template YAML under `templates/{system,thing}/<name>@<v>/`,
 * rule packs at `templates/rule-packs/<id>@<v>/pack.dl`, and the Peopling app as the scaffold of every Thing template
 * whose `scaffold.yaml` bundles it.
 */
export function examplePlatform(app: Record<string, string> = exampleApp): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, text] of Object.entries(templateYaml)) {
    out[p] = text;
    if (p.endsWith("/scaffold.yaml") && /^bundle:\s*examples\/peopling-app\s*$/m.test(text)) {
      const dir = p.slice(0, -"scaffold.yaml".length);
      for (const [f, t] of Object.entries(app)) out[`${dir}scaffold/${f}`] = t;
    }
  }
  for (const [f, text] of Object.entries(rulePacks)) out[`templates/rule-packs/${f.slice(0, -3)}/pack.dl`] = text;
  return out;
}

export const exampleSystemId = /^id:\s*(\S+)/m.exec(exampleGenome["node.yaml"] ?? "")?.[1] ?? "system.peopling";

export type FakeSeed = "peopling" | "artyfact" | "both";

/** `FAKE_SEED`: which Systems the fake platform imports; anything else is the default, Peopling. */
export const fakeSeed = (v: string | undefined): FakeSeed => (v === "artyfact" || v === "both" ? v : "peopling");

interface SeedSystem { systemId: string; genome: Record<string, string>; app: Record<string, string>; title: string }

async function seedSystems(seed: FakeSeed): Promise<SeedSystem[]> {
  const out: SeedSystem[] = [];
  if (seed !== "artyfact") out.push({ systemId: exampleSystemId, genome: exampleGenome, app: exampleApp, title: "Peopling" });
  if (seed !== "peopling") {
    const a = await import("./fake-seed-artyfact");
    out.push({ systemId: a.artyfactSystemId, genome: a.artyfactGenome, app: a.artyfactApp, title: "Artyfact" });
  }
  return out;
}

let booted: Promise<FakeArtifacts> | undefined;
let git: FakeReceivePack | undefined;

/** Serve a fake repo over Git smart HTTP (`/api/fake-git/<repo>.git/...`): clone and fetch need a read token, push a write token. */
export async function fakeGitFetch(request: Request): Promise<Response> {
  if (!git) return new Response("fake platform not booted", { status: 503 });
  return git.fetch(request);
}

/** Install the fake namespace and import the example System once per isolate; later calls reuse it. */
export function ensureFakePlatform(env: Env): Promise<FakeArtifacts> {
  booted ??= boot(env).catch((e: unknown) => {
    booted = undefined;
    throw e;
  });
  return booted;
}

/** Test hook: forget the booted namespace and uninstall it. */
export function resetFakePlatform(): void {
  booted = undefined;
  setArtifactsOverride(undefined);
  setEditorTransport(undefined);
  git = undefined;
}

async function boot(env: Env): Promise<FakeArtifacts> {
  const ns = new FakeArtifacts();
  ns.remoteBase = FAKE_REMOTE_BASE;
  const systems = await seedSystems(fakeSeed(env.FAKE_SEED));
  for (const s of systems) {
    const { genomeRepo, appRepo } = systemRepoNames(s.systemId);
    ns.create(genomeRepo).commit(s.genome, `${s.title} Genome`);
    ns.create(appRepo).commit(s.app, `${s.title} app`);
  }
  ns.create(PLATFORM_REPO).commit(examplePlatform(), "platform-sync");
  setArtifactsOverride(ns);
  git = fakeReceivePack(ns);
  setEditorTransport({ fetch: git.fetch });
  for (const { systemId } of systems) {
    const { genomeRepo, appRepo } = systemRepoNames(systemId);
    if (await registryStub(env).hasSystem(systemId)) continue;
    await importSystem(env, { systemId, genomeRepo, appRepo, review: false });
    if (systemId === exampleSystemId) await seedActivity(env, ns, systemId);
  }
  return ns;
}

/** Ids of the activity {@link seedActivity} records on Peopling (tests and e2e specs key on them). */
export const FAKE_ACTIVITY = {
  build: "build.seed.production",
  event: "seed-1",
  evolution: "evolution.1",
  criterion: "C.webapp.exists",
  agent: "agent:seed",
  /** The file the seed candidate adds to the app (a path nothing else touches, so later candidates do not conflict). */
  path: "NOTES.md",
} as const;

/**
 * Populated Deployments and Evaluations on a fresh fake Peopling, through the same services the routes use: one passed
 * production build of the imported app commit with its realized output (CI reporter), which records the System's live
 * deployment; one runtime event from that deployment (admin ingest, attributed to the output, so later events of the
 * same commit without that output group as their own version); and one realization of `evolution.1` whose candidate
 * carries a single evaluation, the manifest assay of `C.webapp.exists` run on the candidate's tree. The candidate stays
 * open (evaluated).
 */
async function seedActivity(env: Env, ns: FakeArtifacts, systemId: string): Promise<void> {
  const stub = systemStub(env, systemId);
  const state = await stub.state();
  const appCommit = state?.appSource?.commit;
  if (!state || !appCommit) throw new Error(`fake seed: ${systemId} has no app commit`);
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

  const { build } = await reportBuild(env, systemId, null, {
    id: FAKE_ACTIVITY.build, status: "passed", kind: "production", commit: appCommit, buildId: appCommit,
    url: "https://peopling.fake.workers.dev",
    steps: [{ name: "install", status: "passed", durationMs: 8_000 }, { name: "build", status: "passed", durationMs: 6_000 }, { name: "deploy", status: "passed", durationMs: 4_000 }],
    startedAt: at(12), finishedAt: at(10), output: { locator: "workers-version:fake-seed", digest: "sha256:fake-seed" },
  }, "ci");
  const deployment = await stub.liveProduction();
  if (!deployment?.output || !build.thingId || !build.artifactId) throw new Error("fake seed: the production build recorded no live deployment of its output");

  const ingested = await ingestEvents(env, systemId, { kind: "admin" }, {
    events: [{
      id: FAKE_ACTIVITY.event, systemId, thingId: build.thingId, artifactId: build.artifactId, buildId: appCommit, commit: appCommit,
      ...(state.head && { systemCommit: state.head }), deploymentId: deployment.id, emittedAt: at(5),
      kind: "journey.step", subject: "screen.people", payload: { step: "open" },
    }],
  });
  if (ingested.accepted !== 1) throw new Error(`fake seed: runtime event dropped: ${JSON.stringify(ingested.dropped)}`);

  const started = await startWork(env, systemId, FAKE_ACTIVITY.evolution, { agentLabel: FAKE_ACTIVITY.agent, target: "app" }, "http://localhost");
  const rid = started.realization.id;
  const rec = await stub.realization(rid);
  if (!rec) throw new Error(`fake seed: realization ${rid} missing`);
  const files = { ...exampleApp, [FAKE_ACTIVITY.path]: "# Notes\n\nSeeded by the fake platform.\n" };
  const fork = ns.repo(rec.forkRepo);
  const commit = fork.commit(files, "Add notes");
  const built = await buildCandidateManifest(fork, {
    realizationId: rid, evolutionId: rec.evolutionId, target: rec.target, repo: rec.forkRepo, baseRepo: rec.baseRepo, baseCommit: rec.baseCommit, commit,
  }, []);
  const manifest = { ...built, manifestHash: await manifestHash(built) };
  const { candidate } = await stub.recordCandidate({ realizationId: rid, commit, manifest, changedPaths: manifest.changedPaths, changedNodes: manifest.changedNodes });

  const model = (await genomeAt(env, systemId, state.genomeCommit, state.genomeSource)).model;
  const criterion = model.criteria.find((c) => c.id === FAKE_ACTIVITY.criterion);
  const hook = criterion && hooksOf(model, criterion).find((h) => h.engine === "manifest");
  if (!criterion || !hook) throw new Error(`fake seed: ${FAKE_ACTIVITY.criterion} has no manifest hook`);
  const enc = new TextEncoder();
  const outcome = manifestExists(Object.entries(files).map(([path, text]) => ({ path, size: enc.encode(text).length })), hook.inputs);
  const evaluation = toEvaluation({ candidate: candidate.id, hook, criterion, targetRef: `app@${commit}`, startedAt: at(2), finishedAt: at(2) }, outcome);
  await stub.recordEvaluations(candidate.id, [evaluation], "evaluated");
  await refreshRegistry(env, systemId);
}
