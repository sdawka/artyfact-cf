import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main";

const ROOT = join(__dirname, "../../..");
const SRC = join(ROOT, "packages/ontology/test/fixtures/artyfact/keep-in-touch-system");
const FIXTURE = join(ROOT, "examples/keep-in-touch-system");

const run = async (args: string[], cwd: string) => {
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { out: (s) => out.push(s), err: (s) => err.push(s), cwd, env: {} });
  return { code, out: out.join("\n"), err: err.join("\n") };
};
const list = (dir: string, base = ""): string[] =>
  readdirSync(join(dir, base), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(dir, join(base, e.name)) : [join(base, e.name)]))
    .filter((p) => /\.ya?ml$/.test(p)).sort();

describe("artyfact convert-genome", () => {
  it("writes the v2 tree of a v1 Genome into a new directory", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "artyfact-convert-"));
    const r = await run(["convert-genome", SRC, "kit-v2"], tmp);
    expect(r).toMatchObject({ code: 0, err: "" });
    expect(r.out).toMatch(/239 nodes, 6 change records/);
    const dst = join(tmp, "kit-v2");
    expect(list(dst)).toEqual(list(FIXTURE));
    // The example differs from the converter's output by hand edits: node `files` (from the app's v1 source-map.yaml)
    // and the v1 noise fields the committed tree dropped (`owningThing`, `revision: 1`, step defaults).
    const trim = (t: string) => t.replace(/^files:\n(  - .*\n)+/m, "").replace(/^  (owningThing: thing\.webapp|revision: 1|unresolved: false|kind: action)\n/gm, "");
    for (const p of list(FIXTURE)) expect(trim(readFileSync(join(dst, p), "utf8"))).toBe(trim(readFileSync(join(FIXTURE, p), "utf8")));
  });

  it("refuses a non-empty destination, a non-v1 source and missing arguments", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "artyfact-convert-"));
    mkdirSync(join(tmp, "full"));
    writeFileSync(join(tmp, "full/x.txt"), "x");
    expect((await run(["convert-genome", SRC, "full"], tmp)).err).toMatch(/exists and is not an empty directory/);
    expect((await run(["convert-genome", FIXTURE, "out"], tmp)).err).toMatch(/is not a v1 Genome/);
    expect((await run(["convert-genome", SRC], tmp)).err).toMatch(/usage: artyfact convert-genome/);
    expect((await run(["convert-genome", SRC, "out", "--templates", "nope"], tmp)).err).toMatch(/templates directory .* not found/);
  });
});
