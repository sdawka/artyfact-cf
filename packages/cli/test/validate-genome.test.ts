import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main";

const ROOT = join(__dirname, "../../..");
const GENOME = join(ROOT, "examples/peopling-system");
const APP = join(ROOT, "examples/peopling-app");

const run = async (args: string[], cwd = ROOT) => {
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (s) => out.push(s), err: (s) => err.push(s), cwd, env: {} });
  return { code, out: out.join("\n"), err: err.join("\n") };
};
const put = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

/** A one-Thing CLI repo with its Genome, valid against the bundled templates. */
function miniRepo() {
  const tmp = mkdtempSync(join(tmpdir(), "artyfact-validate-"));
  const app = join(tmp, "app"), genome = join(tmp, "genome");
  put(app, "package.json", '{"name":"hello"}');
  put(app, "src/main.ts", "export {};\n");
  put(app, "src/greet.ts", "export {};\n");
  put(app, "bin/hello.js", "#!/usr/bin/env node\n");
  put(app, "test/greet.test.ts", "\n");
  execFileSync("git", ["init", "-q"], { cwd: app });
  execFileSync("git", ["add", "-A"], { cwd: app });
  put(genome, "node.yaml", "id: system.hello\nkind: system\ntemplate: template.system.dev-platform.cloudflare@1\nfields: {name: Hello, description: A greeting tool.}\n");
  for (const s of ["purpose", "theory", "description"]) {
    put(genome, `section.${s}/node.yaml`, `id: system.hello.${s}\nkind: section\nfields: {name: ${s}, description: The ${s}.}\n`);
  }
  put(genome, "thing.cli/node.yaml", `id: thing.cli
kind: thing
template: template.thing.cli@1
fields: {name: Hello CLI, description: The hello tool.}
links:
  - {rel: artifact, to: artifact.cli}
criteria:
  - id: C.thing.cli.checks
    title: Changed nodes meet their checks
    claim: Changed nodes meet the checks their kinds declare.
    severity: soft
    gates: [submission]
    hooks:
      - {id: hook.thing.cli.checks, assay: cli.checks, tier: semantic, engine: model-rules, triggers: [submission], inputs: {packs: checks@1}, binding: bound, fromTemplate: "template.thing.cli@1"}
    fromTemplate: template.thing.cli@1
`);
  put(genome, "thing.cli/artifact.cli/node.yaml", "id: artifact.cli\nkind: artifact\nfields: {type: external, repo: hello, scope: ['.']}\n");
  put(genome, "thing.cli/section.commands/node.yaml", "id: thing.cli.commands\nkind: section\nfields: {name: Commands, description: The commands.}\n");
  put(genome, "thing.cli/section.modules/node.yaml", "id: thing.cli.modules\nkind: section\nfields: {name: Modules, description: The modules.}\n");
  put(genome, "thing.cli/section.commands/command.greet/node.yaml", "id: command.greet\nkind: command\nfields: {name: greet, usage: hello greet <name>, description: Prints a greeting; exits 1 without a name.}\n");
  put(genome, "thing.cli/section.modules/module.greet/node.yaml", "id: module.cli.greet\nkind: module\nfields: {name: Greet, description: Builds the greeting.}\nlinks: [{rel: implements, to: command.greet}]\n");
  return { tmp, app, genome };
}

describe("artyfact validate-genome", () => {
  it("accepts the Peopling example with its app", async () => {
    const r = await run(["validate-genome", "examples/peopling-system", "--app", "examples/peopling-app"]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^system\.peopling {2}template\.system\.social-networking\.cloudflare@1 {2}\(genome: examples\/peopling-system\)/);
    expect(r.out).toContain("things: thing.webapp (root ., template.thing.cloudflare-worker-webapp@1)");
    expect(r.out).toMatch(/^ok: ready for `npx artyfact init --genome examples\/peopling-system --app examples\/peopling-app`$/m);
    const j = JSON.parse((await run(["validate-genome", GENOME, "--app", APP, "--json"])).out);
    expect(j.system).toBe("system.peopling");
    expect(j.findings.filter((f: { level: string }) => f.level === "error")).toEqual([]);
    expect(j.counts).toMatchObject({ nodes: 243, evolutions: 6 });
    expect(j.ok).toBe(true);
    expect(j.unmapped).toEqual([]);
    // The Genome binds the files its planned evolution.2 will add; the app does not ship them yet.
    expect(j.stale).toEqual([
      { node: "entity.ContactEvent", glob: "src/worker/routes/events.ts" },
      { node: "entity.RelationshipGoal", glob: "src/worker/routes/goals.ts" },
      { node: "operation.contact.log", glob: "src/worker/routes/events.ts" },
      { node: "operation.goal.save", glob: "src/worker/routes/goals.ts" },
      { node: "screen.goal", glob: "public/goals/**" },
      { node: "screen.logContact", glob: "public/log/**" },
      { node: "screen.today", glob: "public/today/**" },
      { node: "section.events", glob: "src/worker/routes/events.ts" },
      { node: "section.goals", glob: "src/worker/routes/goals.ts" },
    ]);
  });

  it("reports a missing app as no file check", async () => {
    const r = await run(["validate-genome", GENOME]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("files: no app dir given (--app)");
  });

  it("accepts a small valid Genome and fails --strict on an unmapped file", async () => {
    const { app, genome } = miniRepo();
    const ok = await run(["validate-genome", genome, "--app", app, "--json"]);
    expect(JSON.parse(ok.out)).toMatchObject({ ok: true, unmapped: [], stale: [] });
    expect(ok.code).toBe(0);
    put(app, "notes.md", "x\n");
    execFileSync("git", ["add", "-A"], { cwd: app });
    expect((await run(["validate-genome", genome, "--app", app])).code).toBe(0);
    const strict = await run(["validate-genome", genome, "--app", app, "--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.out).toMatch(/^ {2}unmapped {2}notes\.md$/m);
    put(app, ".artyfactignore", "notes.md\n");
    expect((await run(["validate-genome", genome, "--app", app, "--strict"])).code).toBe(0);
  });

  it("reports a stale declared glob", async () => {
    const { app, genome } = miniRepo();
    put(genome, "thing.cli/section.modules/module.greet/node.yaml", "id: module.cli.greet\nkind: module\nfields: {name: Greet, description: Builds the greeting.}\nlinks: [{rel: implements, to: command.greet}]\nfiles: [src/ghost.ts]\n");
    const r = await run(["validate-genome", genome, "--app", app, "--strict"]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^ {2}stale {5}module\.cli\.greet: src\/ghost\.ts$/m);
  });

  it("fails with the codec issue when a node.yaml has no parent node", async () => {
    const { genome } = miniRepo();
    put(genome, "thing.cli/orphan/child/node.yaml", "id: module.cli.child\nkind: module\nfields: {name: Child, description: Lost.}\n");
    const r = await run(["validate-genome", genome]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("thing.cli/orphan/child/node.yaml");
    expect(r.out).toContain("no node.yaml in the enclosing directory thing.cli/orphan");
    expect(r.out).toContain("not ok: fix the errors above");
  });

  it("fails on readiness errors", async () => {
    const { genome } = miniRepo();
    put(genome, "thing.cli/section.modules/module.greet/node.yaml", "id: module.cli.greet\nkind: module\nfields: {name: Greet, description: Builds the greeting.}\nlinks: [{rel: implements, to: command.ghost}]\n");
    const r = await run(["validate-genome", genome]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^ {2}error {3}ref\.dangling/m);
  });

  it("refuses a v1 layout with the legacy message", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "artyfact-validate-"));
    cpSync(join(ROOT, "packages/ontology/test/fixtures/artyfact/peopling-system"), join(tmp, "v1"), { recursive: true });
    const r = await run(["validate-genome", join(tmp, "v1")]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/predates the node-tree Genome format/);
  });

  it("checks its arguments", async () => {
    expect((await run(["validate-genome"])).err).toMatch(/usage: artyfact validate-genome/);
    expect((await run(["validate-genome", "nope"])).err).toMatch(/nope is not a directory/);
    expect((await run(["validate-genome", GENOME, "--app", "nope"])).err).toMatch(/nope is not a directory/);
  });
});
