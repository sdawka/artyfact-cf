#!/usr/bin/env node
// Builds the published CLI: dist/artyfact.mjs (workspace packages and npm dependencies bundled in, only Node
// built-ins external) plus dist/templates, the template and rule-pack files convert-genome reads from disk.
// The skill stays at skills/ beside dist/, so src/skill.ts resolves ../skills from either directory.
import { build } from "esbuild";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const templates = join(pkg, "..", "templates");
const dist = join(pkg, "dist");

rmSync(dist, { recursive: true, force: true });
const result = await build({
  entryPoints: [join(pkg, "src", "main.ts")],
  outfile: join(dist, "artyfact.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: [...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  // Bundled CommonJS dependencies call require() for built-ins; ESM output has no require of its own.
  banner: { js: 'import { createRequire as __artyfactRequire } from "node:module";\nconst require = __artyfactRequire(import.meta.url);' },
  legalComments: "eof",
  logLevel: "warning",
  metafile: true,
});
for (const dir of ["system", "thing", "rule-packs"]) cpSync(join(templates, dir), join(dist, "templates", dir), { recursive: true });
// The license, and the license of every npm package bundled into artyfact.mjs.
const repo = join(pkg, "..", "..");
cpSync(join(repo, "LICENSE"), join(dist, "LICENSE"));
const bundled = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (m) bundled.add(m[1]);
}
const notices = [...bundled].sort().map((name) => {
  const dir = join(repo, "node_modules", name);
  const { version, license } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  if (!file || !existsSync(join(dir, file))) throw new Error(`${name} ships no license file`);
  return `## ${name}@${version} (${license})\n\n${readFileSync(join(dir, file), "utf8").trim()}\n`;
});
writeFileSync(join(dist, "THIRD_PARTY_LICENSES.md"), `# Bundled third-party packages\n\n${notices.join("\n")}`);
console.log("bundled dist/artyfact.mjs and dist/templates");
