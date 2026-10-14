/// <reference types="vite/client" />
/**
 * `FAKE_SEED=artyfact|both`: Artyfact itself as a fake-platform System. The Genome is the repo-root `genome/`; the app
 * repo is this repo's source, narrowed to what the Genome's node `files` point at (no tests, fixtures, stylesheets or generated
 * Worker types), with paths repo-relative so each Thing's `root` resolves. Loaded only when the seed asks for it.
 */
// Glob keys are relative to this file, and Vite shortens them (apps/ci/x is `../../../ci/x` here, apps/platform/src/x is
// `../../src/x`), so resolve each key against this file's place in the repo rather than cutting a fixed prefix.
const HERE = "file:///repo/apps/platform/worker/artifacts/";
const ROOT = "/repo/";

const repoRelative = (files: Record<string, string>, under = "") =>
  Object.fromEntries(Object.entries(files).map(([p, t]) => [new URL(p, HERE).pathname.slice(ROOT.length + under.length), t] as const));

export const artyfactSystemId = "system.artyfact";

export const artyfactGenome = repoRelative(import.meta.glob("../../../../genome/**/*.yaml",
  { query: "?raw", import: "default", eager: true }) as Record<string, string>, "genome/");

export const artyfactApp = repoRelative(import.meta.glob([
  "../../../../package.json",
  "../../../../{apps,packages}/*/package.json",
  "../../../../apps/*/{src,worker}/**/*",
  "../../../../packages/*/src/**/*",
  "!**/node_modules/**", "!**/*.css", "!**/env.d.ts", "!**/src/fixtures/**", "!**/src/generated/**", "!**/*.test.{ts,tsx}",
], { query: "?raw", import: "default", eager: true }) as Record<string, string>);
