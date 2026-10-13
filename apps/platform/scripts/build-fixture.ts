// Regenerates src/fixtures/keep-in-touch.model.json from examples/keep-in-touch-system:
// loadGenome + the bundled meta@1 templates, readiness from validate(model) (the System's pinned template packs).
// Also writes src/fixtures/keep-in-touch.files.json ({ entries, files }) from the same tree, so the Code view
// can browse the Genome in fixture mode. `hash` is the git blob id of the content.
// Run: npm run build:fixture -w @artyfact/platform
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";
import { isBlocking } from "../shared/verdict.ts";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const example = join(repo, "examples/keep-in-touch-system");
const out = fileURLToPath(new URL("../src/fixtures/keep-in-touch.model.json", import.meta.url));
const filesOut = fileURLToPath(new URL("../src/fixtures/keep-in-touch.files.json", import.meta.url));
if (!existsSync(join(example, "node.yaml"))) {
  console.error(`build-fixture: ${relative(repo, example)}/node.yaml not found; the example Genome is required.`);
  process.exit(1);
}

// The model and templates packages are TypeScript sources with extensionless imports; load them through Vite.
const { module: model } = await runnerImport<typeof import("@artyfact/model")>(join(repo, "packages/model/src/index.ts"));
const { module: tpl } = await runnerImport<typeof import("@artyfact/templates")>(join(repo, "packages/templates/src/index.ts"));

function readTree(dir: string, files = new Map<string, string>()) {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === "test") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readTree(p, files);
    else if (/\.ya?ml$/.test(name)) files.set(relative(example, p), readFileSync(p, "utf8"));
  }
  return files;
}

const tree = readTree(example);
const m = model.loadGenome(tree, { revision: "canonical", templates: tpl.metaTemplates });
const readiness = model.validate(m);

// The wire ReadinessReport (shared/api.ts) carries @artyfact/model Findings unchanged.
const findings = readiness.findings;
const active = m.criteria.filter((c) => !c.deferred).length;
const { index: _index, templates: _templates, graph: _graph, template: _template, ...serialisable } = m;

const bundle = {
  systemId: m.system.id,
  revision: "canonical",
  genomeCommit: "0".repeat(40),
  model: serialisable,
  readiness: {
    modelReadiness: { findings, blockers: findings.filter(isBlocking) },
    implementationConformance: { pass: 0, fail: 0, unknown: 0, stale: 0, notRun: active },
    outcomeProgress: { observed: 0, unknown: m.claims.filter((c) => !c.deferred).length },
    computedAt: "1970-01-01T00:00:00.000Z",
  },
};
writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`wrote ${relative(repo, out)}: ${m.nodes.length} nodes, ${m.criteria.length} criteria, ${findings.length} findings`);

const blobId = (text: string) => {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
};
const paths = [...tree.keys()].sort();
const files = {
  entries: paths.map((path) => ({ path, hash: blobId(tree.get(path)!), size: Buffer.byteLength(tree.get(path)!, "utf8") })),
  files: Object.fromEntries(paths.map((path) => [path, tree.get(path)!])),
};
writeFileSync(filesOut, `${JSON.stringify(files, null, 2)}\n`);
console.log(`wrote ${relative(repo, filesOut)}: ${paths.length} files`);
