import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { main } from "../src/main.ts";

const tmp = mkdtempSync(join(tmpdir(), "artyfact-parts-cli-"));
const requests: Array<{ method: string; url: string; auth?: string; body?: unknown }> = [];
const base = "https://platform.test";

const astro = {
  id: "part.framework.astro", version: "1.0.0", name: "Astro", visibility: "shared", published: true,
  payload: { model: { "things/site/thing.yaml": "id: thing.site\n" }, files: {
    "src/components/Button.ts": "export const Button = 'astro'\n",
    "src/pages/index.ts": "import { Button } from '../components/Button.ts'\n",
    "astro.config.mjs": "export default { integrations: [] }\n",
  } },
};
const ui = {
  id: "part.ui.system", version: "2.0.0", name: "UI", visibility: "shared", published: true,
  payload: { model: {}, files: {
    "src/components/Button.ts": "export const Button = 'system'\n",
    "src/obsolete.ts": "remove me\n",
    "scripts/adapt.mjs": "import { readFileSync, rmSync, writeFileSync } from 'node:fs'; const p='src/pages/index.ts'; writeFileSync(p, readFileSync(p,'utf8').replace('../components/Button.ts','@ui/Button')); writeFileSync('astro.config.mjs', 'export default { integrations: [\"ui\"] }\\n'); writeFileSync('src/generated.ts', 'export const generated = true\\n'); writeFileSync('constructor', 'own property path\\n'); rmSync('src/obsolete.ts');\n",
  } },
  commands: [{ id: "adapt-callers", run: "node scripts/adapt.mjs", purpose: "Adapt Astro callers and config" }],
};
const privatePart = {
  id: "part.private", version: "1", name: "Private", visibility: "system-private", systemId: "system.demo", published: true,
  payload: { model: {}, files: { "private.txt": "private\n" } },
};
const catalog = new Map<string, Record<string, unknown>>([[`${astro.id}@${astro.version}`, astro], [`${ui.id}@${ui.version}`, ui]]);
const privateCatalog = new Map<string, Record<string, unknown>>([[`${privatePart.id}@${privatePart.version}`, privatePart]]);

const fetchMock = (async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = new URL(String(input));
  const bodyText = init.body ? String(init.body) : "";
  requests.push({ method: init.method ?? "GET", url: `${url.pathname}${url.search}`, auth: new Headers(init.headers).get("authorization") ?? undefined, body: bodyText ? JSON.parse(bodyText) : undefined });
  if ((init.method ?? "GET") === "GET") {
    const privateMatch = /^\/api\/systems\/([^/]+)\/parts\/([^/]+)\/([^/?]+)/.exec(url.pathname);
    const sharedMatch = /^\/api\/parts\/([^/]+)\/([^/?]+)/.exec(url.pathname);
    const part = privateMatch
      ? privateCatalog.get(`${decodeURIComponent(privateMatch[2]!)}@${decodeURIComponent(privateMatch[3]!)}`)
      : sharedMatch && catalog.get(`${decodeURIComponent(sharedMatch[1]!)}@${decodeURIComponent(sharedMatch[2]!)}`);
    return new Response(JSON.stringify(part ? { part } : { error: { code: "not-found", message: "missing" } }), { status: part ? 200 : 404 });
  }
  return new Response(JSON.stringify({ part: bodyText ? JSON.parse(bodyText).package : undefined }), { status: 201 });
}) as typeof fetch;

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

async function run(args: string[], env: Record<string, string> = {}) {
  const out: string[] = [], err: string[] = [];
  const code = await main(args, { cwd: tmp, env: { ARTYFACT_URL: base, ...env }, fetch: fetchMock, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("parts authoring", () => {
  it("previews create without writing and packages only safe source files on apply", async () => {
    const source = join(tmp, "create-source");
    mkdirSync(join(source, "genome/things/demo"), { recursive: true });
    mkdirSync(join(source, "app/src"), { recursive: true });
    mkdirSync(join(source, "app/node_modules/pkg"), { recursive: true });
    writeFileSync(join(source, "genome/things/demo/thing.yaml"), "id: thing.demo\n");
    writeFileSync(join(source, "app/src/index.ts"), "export {}\n");
    writeFileSync(join(source, "app/.env"), "TOKEN=nope\n");
    writeFileSync(join(source, "app/node_modules/pkg/index.js"), "nope\n");
    symlinkSync("/etc/passwd", join(source, "app/src/outside"));
    const out = join(tmp, "created.json");

    const preview = await run(["parts", "create", "--id", "part.demo", "--version", "1.0.0", "--name", "Demo", "--source", source, "--out", out]);
    expect(preview.code, preview.err).toBe(0);
    expect(preview.out).toContain("Preview");
    expect(existsSync(out)).toBe(false);

    const applied = await run(["parts", "create", "--id", "part.demo", "--version", "1.0.0", "--name", "Demo", "--source", source, "--out", out, "--apply"]);
    expect(applied.code, applied.err).toBe(0);
    const part = JSON.parse(readFileSync(out, "utf8"));
    expect(part.payload).toEqual({ model: { "things/demo/thing.yaml": "id: thing.demo\n" }, files: { "src/index.ts": "export {}\n" } });
  });

  it("rejects binary source instead of corrupting it as UTF-8", async () => {
    const source = join(tmp, "binary-source");
    mkdirSync(join(source, "app/assets"), { recursive: true });
    writeFileSync(join(source, "app/assets/logo.bin"), Buffer.from([0, 255, 1]));
    const out = join(tmp, "binary.json");
    const result = await run(["parts", "create", "--id", "part.binary", "--version", "1", "--name", "Binary", "--source", source, "--out", out, "--apply"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("binary files are not supported");
    expect(existsSync(out)).toBe(false);
  });

  it("refuses an output whose parent chain contains a symlink", async () => {
    const source = join(tmp, "safe-source");
    const victim = join(tmp, "output-victim");
    mkdirSync(join(source, "app"), { recursive: true });
    mkdirSync(victim);
    symlinkSync(victim, join(tmp, "linked-output"));
    const result = await run(["parts", "create", "--id", "part.safe", "--version", "1", "--name", "Safe", "--source", source, "--out", join(tmp, "linked-output/nested/part.json"), "--apply"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("symlinked output parent");
    expect(existsSync(join(victim, "nested/part.json"))).toBe(false);

    const dangling = join(tmp, "dangling-part.json");
    const missing = join(tmp, "missing-part-target.json");
    symlinkSync(missing, dangling);
    const danglingResult = await run(["parts", "create", "--id", "part.safe", "--version", "1", "--name", "Safe", "--source", source, "--out", dangling, "--apply"]);
    expect(danglingResult.code).toBe(1);
    expect(danglingResult.err).toContain("refusing to overwrite");
    expect(readlinkSync(dangling)).toBe(missing);
    expect(existsSync(missing)).toBe(false);
  });

  it("validates immutable coordinates and publishes only with an admin bearer", async () => {
    const file = join(tmp, "publish.json");
    writeFileSync(file, JSON.stringify({ ...astro, published: false }));
    expect((await run(["parts", "validate", file])).out).toMatch(/valid .*sha256:/);
    const preview = await run(["parts", "publish", file]);
    expect(preview.code).toBe(0);
    expect(preview.out).toContain("Preview");
    const before = requests.length;
    const missing = await run(["parts", "publish", file, "--apply"]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("ARTYFACT_ADMIN_TOKEN");
    expect(requests).toHaveLength(before);
    const published = await run(["parts", "publish", file, "--apply"], { ARTYFACT_ADMIN_TOKEN: "admin-test" });
    expect(published.code, published.err).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: "POST", url: "/api/parts", auth: "Bearer admin-test", body: { package: { published: true, digest: expect.stringMatching(/^sha256:/) } } });
  });

  it("reads a System-private exact version only with a System credential", async () => {
    const recipe = join(tmp, "private-recipe.json");
    writeFileSync(recipe, JSON.stringify({ id: "recipe.private", contributions: [{ id: "private", part: { id: privatePart.id, version: privatePart.version } }] }));
    const denied = await run(["parts", "compose", recipe, "--system", "system.demo", "--out", join(tmp, "private-denied")]);
    expect(denied.code).toBe(1);
    expect(denied.err).toContain("private Part reads require");
    const allowed = await run(["parts", "compose", recipe, "--system", "system.demo", "--out", join(tmp, "private-ok")], { ARTYFACT_SECRET: "a".repeat(64) });
    expect(allowed.code, allowed.err).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: "GET", url: "/api/systems/system.demo/parts/part.private/1", auth: `Bearer ${"a".repeat(64)}` });
  });

  it("composes pinned catalog parts, saves provenance/baseline, and runs commands only when explicit", async () => {
    const recipe = join(tmp, "recipe.json");
    writeFileSync(recipe, JSON.stringify({ id: "recipe.astro-ui", contributions: [
      { id: "app", part: { id: astro.id, version: astro.version } },
      { id: "ui", part: { id: ui.id, version: ui.version }, replacements: [{ kind: "file", path: "src/components/Button.ts", contribution: "app" }] },
    ] }));
    const target = join(tmp, "composition");
    const preview = await run(["parts", "compose", recipe, "--out", target]);
    expect(preview.code, preview.err).toBe(0);
    expect(preview.out).toContain("Preview");
    expect(existsSync(target)).toBe(false);

    const applied = await run(["parts", "compose", recipe, "--out", target, "--apply"]);
    expect(applied.code, applied.err).toBe(0);
    expect(readFileSync(join(target, "app/src/pages/index.ts"), "utf8")).toContain("../components/Button.ts");
    expect(readFileSync(join(target, "app/astro.config.mjs"), "utf8")).toContain("integrations: []");
    expect(JSON.parse(readFileSync(join(target, ".artyfact/composition.json"), "utf8")).provenance.packages).toHaveLength(2);
    expect(JSON.parse(readFileSync(join(target, ".artyfact/baseline.json"), "utf8")).files["src/components/Button.ts"]).toContain("system");

    const commanded = join(tmp, "composition-commanded");
    const ran = await run(["parts", "compose", recipe, "--out", commanded, "--apply", "--run-commands"]);
    expect(ran.code, ran.err).toBe(0);
    expect(readFileSync(join(commanded, "app/src/pages/index.ts"), "utf8")).toContain("@ui/Button");
    expect(readFileSync(join(commanded, "app/astro.config.mjs"), "utf8")).toContain("integrations: [\"ui\"]");
    expect(JSON.parse(readFileSync(join(commanded, ".artyfact/baseline.json"), "utf8")).files["src/pages/index.ts"]).toContain("@ui/Button");
    const saved = JSON.parse(readFileSync(join(commanded, ".artyfact/composition.json"), "utf8"));
    expect(saved.provenance.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/pages/index.ts", disposition: "adapted", command: { id: "adapt-callers", contribution: "ui", action: "changed" } }),
      expect.objectContaining({ path: "src/generated.ts", disposition: "adapted", command: { id: "adapt-callers", contribution: "ui", action: "created" } }),
      expect.objectContaining({ path: "constructor", disposition: "adapted", command: { id: "adapt-callers", contribution: "ui", action: "created" } }),
      expect.objectContaining({ path: "src/obsolete.ts", disposition: "excluded", command: { id: "adapt-callers", contribution: "ui", action: "deleted" } }),
    ]));
    expect(saved.provenance.outputs.find((mapping: { path: string }) => mapping.path === "src/generated.ts")).not.toHaveProperty("sourcePath");
  });

  it("executes nested adapters from inner to outer and saves their final output as baseline", async () => {
    const append = (value: string) => `node -e "require('node:fs').appendFileSync('order.txt','${value}\\n')"`;
    const leaf = {
      id: "part.command-leaf", version: "1", name: "Leaf", visibility: "shared", published: true,
      payload: { model: {}, files: { "order.txt": "base\n" } },
      commands: [{ id: "leaf", run: append("leaf"), purpose: "Adapt leaf" }],
    };
    const container = {
      id: "part.command-container", version: "1", name: "Container", visibility: "shared", published: true,
      payload: { model: {}, files: {} },
      recipe: {
        id: "recipe.command-inner",
        contributions: [{ id: "leaf", part: { id: leaf.id, version: leaf.version } }],
        commands: [{ id: "inner", run: append("inner"), purpose: "Adapt inner recipe" }],
      },
      commands: [{ id: "container", run: append("container"), purpose: "Adapt containing Part" }],
    };
    catalog.set(`${leaf.id}@${leaf.version}`, leaf);
    catalog.set(`${container.id}@${container.version}`, container);
    const recipe = join(tmp, "nested-command-recipe.json");
    writeFileSync(recipe, JSON.stringify({
      id: "recipe.command-top",
      contributions: [{ id: "container", part: { id: container.id, version: container.version } }],
      commands: [{ id: "top", run: append("top"), purpose: "Finalize top recipe" }],
    }));
    const target = join(tmp, "nested-command-output");
    const result = await run(["parts", "compose", recipe, "--out", target, "--apply", "--run-commands"]);
    expect(result.code, result.err).toBe(0);
    const expected = "base\nleaf\ninner\ncontainer\ntop\n";
    expect(readFileSync(join(target, "app/order.txt"), "utf8")).toBe(expected);
    expect(JSON.parse(readFileSync(join(target, ".artyfact/baseline.json"), "utf8")).files["order.txt"]).toBe(expected);
  });

  it("extracts from an immutable source request without mutating it", async () => {
    const request = join(tmp, "extract.json");
    const output = join(tmp, "extracted.json");
    const source = { revision: "sc-1", model: { "thing.yaml": "owner: Sam\n", "private.yaml": "secret\n" }, files: { "src.ts": "Sam\n", ".env": "SECRET=x\n" } };
    writeFileSync(request, JSON.stringify({ source, package: { id: "part.profile", version: "1", name: "Profile", visibility: "shared" }, mask: { model: ["private.yaml"], files: [".env"] }, generalize: [{ kind: "file", path: "src.ts", value: "Sam", input: "owner" }] }));
    expect((await run(["parts", "extract", request, "--out", output])).out).toContain("Preview");
    expect(existsSync(output)).toBe(false);
    expect((await run(["parts", "extract", request, "--out", output, "--apply"])).code).toBe(0);
    expect(JSON.parse(readFileSync(output, "utf8")).part.payload).toEqual({ model: { "thing.yaml": "owner: Sam\n" }, files: { "src.ts": "${owner}\n" } });
    expect((await run(["parts", "validate", output])).out).toMatch(/valid part\.profile@1 sha256:/);
    expect(JSON.parse(readFileSync(request, "utf8")).source).toEqual(source);
  });

  it("reports three-way conflicts and leaves current files untouched", async () => {
    const target = join(tmp, "upgrade");
    mkdirSync(join(target, "app"), { recursive: true });
    mkdirSync(join(target, ".artyfact"), { recursive: true });
    writeFileSync(join(target, "app/src.ts"), "mine\n");
    writeFileSync(join(target, ".artyfact/baseline.json"), JSON.stringify({ model: {}, files: { "src.ts": "base\n" } }));
    const recipe = join(tmp, "upgrade-recipe.json");
    const next = { id: "part.next", version: "1", name: "Next", visibility: "shared", published: true, payload: { model: {}, files: { "src.ts": "theirs\n" } } };
    catalog.set("part.next@1", next);
    writeFileSync(recipe, JSON.stringify({ id: "recipe.upgrade", contributions: [{ id: "next", part: { id: "part.next", version: "1" } }] }));

    const result = await run(["parts", "upgrade", recipe, "--from", target, "--apply"]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("conflict file src.ts");
    expect(readFileSync(join(target, "app/src.ts"), "utf8")).toBe("mine\n");
  });

  it("upgrades unchanged generated files, preserves customization, and removes obsolete generated files", async () => {
    const target = join(tmp, "upgrade-clean");
    mkdirSync(join(target, "app"), { recursive: true });
    mkdirSync(join(target, "genome"), { recursive: true });
    mkdirSync(join(target, ".artyfact"), { recursive: true });
    writeFileSync(join(target, "app/generated.ts"), "v1\n");
    writeFileSync(join(target, "app/custom.ts"), "mine\n");
    writeFileSync(join(target, "app/obsolete.ts"), "old\n");
    writeFileSync(join(target, ".artyfact/baseline.json"), JSON.stringify({ model: {}, files: { "generated.ts": "v1\n", "custom.ts": "base\n", "obsolete.ts": "old\n" } }));
    const next = { id: "part.clean-next", version: "2", name: "Next", visibility: "shared", published: true, payload: { model: {}, files: { "generated.ts": "v2\n", "custom.ts": "base\n" } } };
    catalog.set("part.clean-next@2", next);
    const recipe = join(tmp, "upgrade-clean-recipe.json");
    writeFileSync(recipe, JSON.stringify({ id: "recipe.clean-upgrade", contributions: [{ id: "next", part: { id: next.id, version: next.version } }] }));
    const result = await run(["parts", "upgrade", recipe, "--from", target, "--apply"]);
    expect(result.code, result.err).toBe(0);
    expect(readFileSync(join(target, "app/generated.ts"), "utf8")).toBe("v2\n");
    expect(readFileSync(join(target, "app/custom.ts"), "utf8")).toBe("mine\n");
    expect(existsSync(join(target, "app/obsolete.ts"))).toBe(false);

    const third = { id: "part.clean-next", version: "3", name: "Next", visibility: "shared", published: true, payload: { model: {}, files: { "generated.ts": "v3\n", "custom.ts": "upstream3\n" } } };
    catalog.set("part.clean-next@3", third);
    writeFileSync(recipe, JSON.stringify({ id: "recipe.clean-upgrade", contributions: [{ id: "next", part: { id: third.id, version: third.version } }] }));
    const conflict = await run(["parts", "upgrade", recipe, "--from", target, "--apply"]);
    expect(conflict.code).toBe(2);
    expect(conflict.err).toContain("conflict file custom.ts");
    expect(readFileSync(join(target, "app/custom.ts"), "utf8")).toBe("mine\n");
    expect(readFileSync(join(target, "app/generated.ts"), "utf8")).toBe("v2\n");
  });

  it("preflights every in-place upgrade destination before changing any file or metadata", async () => {
    const target = join(tmp, "upgrade-preflight");
    const external = join(tmp, "upgrade-missing-external.txt");
    mkdirSync(join(target, "app"), { recursive: true });
    mkdirSync(join(target, "genome"), { recursive: true });
    mkdirSync(join(target, ".artyfact"), { recursive: true });
    writeFileSync(join(target, "app/a.txt"), "old\n");
    symlinkSync(external, join(target, "app/z.txt"));
    const baselineText = JSON.stringify({ model: {}, files: { "a.txt": "old\n" } });
    writeFileSync(join(target, ".artyfact/baseline.json"), baselineText);
    writeFileSync(join(target, ".artyfact/composition.json"), "original metadata\n");
    const next = { id: "part.preflight-next", version: "1", name: "Next", visibility: "shared", published: true, payload: { model: {}, files: { "a.txt": "new\n", "z.txt": "new target\n" } } };
    catalog.set("part.preflight-next@1", next);
    const recipe = join(tmp, "upgrade-preflight-recipe.json");
    writeFileSync(recipe, JSON.stringify({ id: "recipe.preflight", contributions: [{ id: "next", part: { id: next.id, version: next.version } }] }));
    const result = await run(["parts", "upgrade", recipe, "--from", target, "--apply"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("symlink");
    expect(readFileSync(join(target, "app/a.txt"), "utf8")).toBe("old\n");
    expect(readFileSync(join(target, ".artyfact/baseline.json"), "utf8")).toBe(baselineText);
    expect(readFileSync(join(target, ".artyfact/composition.json"), "utf8")).toBe("original metadata\n");
    expect(existsSync(external)).toBe(false);
  });

  it("adapts the pristine next version before merging and keeps that generated baseline", async () => {
    const target = join(tmp, "upgrade-command-baseline");
    mkdirSync(join(target, "app"), { recursive: true });
    mkdirSync(join(target, "genome"), { recursive: true });
    mkdirSync(join(target, ".artyfact"), { recursive: true });
    writeFileSync(join(target, "app/value.txt"), "v1\n");
    writeFileSync(join(target, ".artyfact/baseline.json"), JSON.stringify({ model: {}, files: { "value.txt": "v1\n" } }));
    const append = (value: string) => `node -e "require('node:fs').appendFileSync('value.txt','${value}\\n')"`;
    const v2 = { id: "part.command-upgrade", version: "2", name: "Command upgrade", visibility: "shared", published: true, payload: { model: {}, files: { "value.txt": "v2\n" } }, commands: [{ id: "adapt-v2", run: append("adapted-v2"), purpose: "Adapt v2" }] };
    catalog.set("part.command-upgrade@2", v2);
    const recipe = join(tmp, "upgrade-command-recipe.json");
    writeFileSync(recipe, JSON.stringify({ id: "recipe.command-upgrade", contributions: [{ id: "next", part: { id: v2.id, version: v2.version } }] }));
    const upgraded = await run(["parts", "upgrade", recipe, "--from", target, "--apply", "--run-commands"]);
    expect(upgraded.code, upgraded.err).toBe(0);
    expect(readFileSync(join(target, "app/value.txt"), "utf8")).toBe("v2\nadapted-v2\n");
    expect(JSON.parse(readFileSync(join(target, ".artyfact/baseline.json"), "utf8")).files["value.txt"]).toBe("v2\nadapted-v2\n");

    writeFileSync(join(target, "app/value.txt"), "mine\n");
    const v3 = { ...v2, version: "3", payload: { model: {}, files: { "value.txt": "v3\n" } }, commands: [{ id: "adapt-v3", run: append("adapted-v3"), purpose: "Adapt v3" }] };
    catalog.set("part.command-upgrade@3", v3);
    writeFileSync(recipe, JSON.stringify({ id: "recipe.command-upgrade", contributions: [{ id: "next", part: { id: v3.id, version: v3.version } }] }));
    const conflict = await run(["parts", "upgrade", recipe, "--from", target, "--apply", "--run-commands"]);
    expect(conflict.code).toBe(2);
    expect(readFileSync(join(target, "app/value.txt"), "utf8")).toBe("mine\n");
  });

  it("refuses to write a complete generated Genome with duplicate model ids", async () => {
    const invalid = {
      id: "part.invalid-genome", version: "1", name: "Invalid", visibility: "shared", published: true,
      payload: { files: {}, model: {
        "system.yaml": "id: system.demo\nname: Demo\ntemplate: null\nthings: [thing.same]\npurposes: []\n",
        "kits.yaml": "kits: []\nrulePacks: []\nrequired: []\n",
        "things/a/thing.yaml": "id: thing.same\nname: A\ntemplateRef: null\ndescription: A\nartifacts: []\npurposeRefs: []\n",
        "things/b/thing.yaml": "id: thing.same\nname: B\ntemplateRef: null\ndescription: B\nartifacts: []\npurposeRefs: []\n",
      } },
    };
    catalog.set("part.invalid-genome@1", invalid);
    const recipe = join(tmp, "invalid-genome-recipe.json");
    const target = join(tmp, "invalid-genome-output");
    writeFileSync(recipe, JSON.stringify({ id: "recipe.invalid-genome", contributions: [{ id: "bad", part: { id: invalid.id, version: invalid.version } }] }));
    const result = await run(["parts", "compose", recipe, "--out", target, "--apply"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain("duplicate id thing.same");
    expect(existsSync(target)).toBe(false);
  });
});
