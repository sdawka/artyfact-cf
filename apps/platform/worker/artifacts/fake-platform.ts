/// <reference types="vite/client" />
/**
 * `FAKE_ARTIFACTS=1` boot mode: the whole backend without a Cloudflare account. On the first request the Worker
 * swaps Artifacts for an in-memory namespace seeded from `examples/` (Keep in Touch), imports that System, and pushes
 * editor commits through a fake git receive-pack. State lives in the isolate, so a restart starts over (the Vite
 * config turns off state persistence in this mode to keep the Durable Objects in step).
 */
import { systemRepoNames } from "@artyfact/cli/naming";
import { setEditorTransport } from "../editor";
import { importSystem, registryStub } from "../service";
import { setArtifactsOverride } from "./client";
import { FakeArtifacts } from "./fake";
import { fakeReceivePack } from "./fake-receive-pack";

const strip = (files: Record<string, string>, root: string) =>
  Object.fromEntries(Object.entries(files).map(([p, t]) => [p.slice(p.indexOf(root) + root.length), t] as const));

export const exampleGenome = strip(import.meta.glob("../../../../examples/keep-in-touch-system/**/*.yaml",
  { query: "?raw", import: "default", eager: true }) as Record<string, string>, "keep-in-touch-system/");
export const exampleApp = strip(import.meta.glob(["../../../../examples/keep-in-touch-app/**/*", "!**/node_modules/**", "!**/.wrangler/**"],
  { query: "?raw", import: "default", eager: true }) as Record<string, string>, "keep-in-touch-app/");
export const exampleSystemId = /^id:\s*(\S+)/m.exec(exampleGenome["system.yaml"] ?? "")?.[1] ?? "system.keep-in-touch";

let booted: Promise<FakeArtifacts> | undefined;

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
}

async function boot(env: Env): Promise<FakeArtifacts> {
  const ns = new FakeArtifacts();
  const { genomeRepo, appRepo } = systemRepoNames(exampleSystemId);
  ns.create(genomeRepo).commit(exampleGenome, "Keep in Touch Genome");
  ns.create(appRepo).commit(exampleApp, "Keep in Touch app");
  setArtifactsOverride(ns);
  setEditorTransport({ fetch: fakeReceivePack(ns).fetch });
  if (!(await registryStub(env).hasSystem(exampleSystemId))) await importSystem(env, { systemId: exampleSystemId, genomeRepo, appRepo });
  return ns;
}
