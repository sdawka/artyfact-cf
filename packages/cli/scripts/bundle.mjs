#!/usr/bin/env node
// Builds the published CLI: dist/artyfact.mjs (workspace packages and npm dependencies bundled in, only Node
// built-ins external) plus dist/templates, the template and rule-pack files convert-genome reads from disk.
// The skill stays at skills/ beside dist/, so src/skill.ts resolves ../skills from either directory.
import { build } from "esbuild";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, resolve } from "node:path";
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
  absWorkingDir: pkg,
});
for (const dir of ["system", "thing", "rule-packs"]) cpSync(join(templates, dir), join(dist, "templates", dir), { recursive: true });
// The license, and the license of every npm package bundled into artyfact.mjs.
const repo = join(pkg, "..", "..");
cpSync(join(repo, "LICENSE"), join(dist, "LICENSE"));
// Each input path ends in node_modules/<name>/<file>; the last such segment is the package the file belongs to
// (pnpm nests packages under node_modules/.pnpm/<id>/node_modules/<name>, so the first match is not enough).
const bundled = new Map();
for (const input of Object.keys(result.metafile.inputs)) {
  const matches = [...input.matchAll(/node_modules\/((?:@[^/]+\/)?[^/.][^/]*)\//g)];
  const m = matches.at(-1);
  if (m) bundled.set(m[1], resolve(pkg, input.slice(0, m.index + m[0].length)));
}
const notices = [...bundled.keys()].sort().map((name) => {
  const dir = bundled.get(name);
  const { version, license } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const file = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
  if (!file || !existsSync(join(dir, file))) throw new Error(`${name} ships no license file`);
  return `## ${name}@${version} (${license})\n\n${readFileSync(join(dir, file), "utf8").trim()}\n`;
});
writeFileSync(join(dist, "THIRD_PARTY_LICENSES.md"), `# Bundled third-party packages\n\n${notices.join("\n")}`);
console.log("bundled dist/artyfact.mjs and dist/templates");
