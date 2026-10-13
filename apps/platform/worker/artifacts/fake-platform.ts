/// <reference types="vite/client" />
/**
 * `FAKE_ARTIFACTS=1` boot mode: the whole backend without a Cloudflare account. On the first request the Worker
 * swaps Artifacts for an in-memory namespace seeded from `examples/` (Peopling), the repo-root `genome/`
 * (Artyfact itself) or both, as `FAKE_SEED` says, and `packages/templates` (the `platform` repo, so template upgrades
 * and provenance work), imports those Systems, and pushes
 * editor commits through a fake git receive-pack. The same fake git server answers `git clone`, `fetch` and `push`
 * at `/fake-git/<repo>.git` (see {@link FAKE_REMOTE_BASE}), so the CLI's `claim`, `start` and `submit` run against it.
 * State lives in the isolate, so a restart starts over (the Vite config turns off state persistence in this mode to
 * keep the Durable Objects in step).
 */
import { PLATFORM_REPO, systemRepoNames } from "@artyfact/cli/naming";
import { setEditorTransport } from "../editor";
import { importSystem, registryStub } from "../service";
import { setArtifactsOverride } from "./client";
import { FakeArtifacts } from "./fake";
import { fakeReceivePack, type FakeReceivePack } from "./fake-receive-pack";

/**
 * The remote every fake repo reports. It has the Artifacts shape the CLI accepts (`https://<host>/git/<ns>/<repo>.git`)
 * on a host that never resolves; git reaches the platform through
 * `url.http://localhost:<port>/fake-git/.insteadOf=https://fake.artifacts.local/git/artyfact/` and the CLI is told to
 * trust the host with `ARTYFACT_ALLOW_REMOTE_HOST=fake.artifacts.local` (docs/demo-runbook.md).
 */
export const FAKE_REMOTE_HOST = "fake.artifacts.local";
export const FAKE_REMOTE_BASE = `https://${FAKE_REMOTE_HOST}/git/artyfact`;
/** The path prefix under which the Worker serves the fake repos over Git smart HTTP. */
export const FAKE_GIT_PREFIX = "/fake-git/";

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

/** Serve a fake repo over Git smart HTTP (`/fake-git/<repo>.git/...`): clone and fetch need a read token, push a write token. */
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
    if (!(await registryStub(env).hasSystem(systemId))) await importSystem(env, { systemId, genomeRepo, appRepo, review: false });
  }
  return ns;
}
