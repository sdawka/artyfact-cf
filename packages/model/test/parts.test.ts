import { describe, expect, it } from "vitest";
import {
  PartCompositionError,
  composeParts,
  extractPart,
  partDigest,
  schema,
  upgradeComposition,
  type PartResolver,
} from "../src/index";

const part = (value: unknown) => schema.PartPackage.parse(value);

const packages = [
  part({
    id: "part.framework.astro",
    version: "1.0.0",
    name: "Astro application",
    visibility: "shared",
    published: true,
    inputs: [{ name: "title", default: "Site" }],
    payload: {
      files: {
        "src/App.ts": "export const title = '${title}'\n",
        "src/Button.ts": "export const Button = 'astro'\n",
        "astro.config.mjs": "export default {}\n",
      },
      model: { "ontology/ui.yaml": "component: ${title}\n" },
    },
  }),
  part({
    id: "part.ui.buttons",
    version: "2.1.0",
    name: "Button system",
    visibility: "shared",
    published: true,
    payload: {
      files: {
        "src/Button.ts": "export const Button = 'system'\n",
        "src/theme.css": ":root { color: blue }\n",
      },
    },
    commands: [{ id: "adapt-imports", run: "node scripts/adapt-imports.mjs", purpose: "Adapt callers and config" }],
  }),
  part({
    id: "part.feature.contact",
    version: "1.0.0",
    name: "Contact feature",
    visibility: "shared",
    published: true,
    payload: { files: { "src/contact.ts": "export const contact = true\n" } },
  }),
  part({
    id: "part.product.shell",
    version: "3.0.0",
    name: "Product shell",
    visibility: "shared",
    published: true,
    recipe: {
      id: "recipe.product.shell",
      contributions: [
        { id: "contact", part: { id: "part.feature.contact", version: "1.0.0" } },
      ],
    },
  }),
] as const;

const resolver: PartResolver = {
  get(ref) {
    return packages.find((p) => p.id === ref.id && p.version === ref.version);
  },
};

describe("composeParts", () => {
  it("keeps nested and repeated contribution identities distinct", () => {
    const result = composeParts(schema.PartRecipe.parse({
      id: "recipe.repeated",
      contributions: [
        { id: "left", part: { id: "part.product.shell", version: "3.0.0" }, files: { rename: { "src/contact.ts": "src/left.ts" } } },
        { id: "right", part: { id: "part.product.shell", version: "3.0.0" }, files: { rename: { "src/contact.ts": "src/right.ts" } } },
      ],
    }), resolver);

    expect(result.files).toEqual({
      "src/left.ts": "export const contact = true\n",
      "src/right.ts": "export const contact = true\n",
    });
    expect(result.provenance.outputs.map((o) => [o.path, o.contribution])).toEqual([
      ["src/left.ts", "left/contact"],
      ["src/right.ts", "right/contact"],
    ]);
  });

  it("fails an undeclared collision without mutating either package", () => {
    const recipe = schema.PartRecipe.parse({
      id: "recipe.collision",
      contributions: [
        { id: "app", part: { id: "part.framework.astro", version: "1.0.0" } },
        { id: "ui", part: { id: "part.ui.buttons", version: "2.1.0" } },
      ],
    });
    const before = JSON.stringify(packages);

    expect(() => composeParts(recipe, resolver)).toThrowError(PartCompositionError);
    expect(() => composeParts(recipe, resolver)).toThrow(/src\/Button\.ts.*app.*ui/);
    expect(JSON.stringify(packages)).toBe(before);
  });

  it("applies scoped replacement, parameterization and masks while only returning commands", () => {
    const result = composeParts(schema.PartRecipe.parse({
      id: "recipe.web",
      contributions: [
        {
          id: "app",
          part: { id: "part.framework.astro", version: "1.0.0" },
          inputs: { title: "Contacts" },
          mask: { files: ["astro.config.mjs"] },
        },
        {
          id: "ui",
          part: { id: "part.ui.buttons", version: "2.1.0" },
          replacements: [{ kind: "file", path: "src/Button.ts", contribution: "app" }],
        },
      ],
    }), resolver);

    expect(result.files).toEqual({
      "src/App.ts": "export const title = 'Contacts'\n",
      "src/Button.ts": "export const Button = 'system'\n",
      "src/theme.css": ":root { color: blue }\n",
    });
    expect(result.model).toEqual({ "ontology/ui.yaml": "component: Contacts\n" });
    expect(result.commands).toEqual([{ contribution: "ui", id: "adapt-imports", run: "node scripts/adapt-imports.mjs", purpose: "Adapt callers and config" }]);
    expect(result.provenance.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "file", path: "astro.config.mjs", contribution: "app", disposition: "excluded" }),
      expect.objectContaining({ kind: "file", path: "src/Button.ts", contribution: "app", disposition: "replaced", by: "ui" }),
      expect.objectContaining({ kind: "file", path: "src/Button.ts", contribution: "ui", disposition: "retained" }),
      expect.objectContaining({ kind: "model", path: "ontology/ui.yaml", contribution: "app", disposition: "adapted" }),
    ]));
  });

  it("preserves nested recipe commands once per contribution in inner-to-outer order", () => {
    const command = (id: string) => ({ id, run: `node ${id}.mjs`, purpose: id });
    const child = part({ id: "part.child", version: "1", name: "Child", visibility: "shared", commands: [command("child")] });
    const shell = part({ id: "part.shell", version: "1", name: "Shell", visibility: "shared", commands: [command("shell")],
      recipe: { id: "recipe.shell", contributions: [{ id: "child", part: { id: child.id, version: child.version } }], commands: [command("inner")] } });
    const recipe = schema.PartRecipe.parse({ id: "recipe.root", contributions: [
      { id: "first", part: { id: shell.id, version: shell.version } },
      { id: "second", part: { id: shell.id, version: shell.version } },
    ], commands: [command("root")] });
    const result = composeParts(recipe, { get: (ref) => [child, shell].find((p) => p.id === ref.id) });
    expect(result.commands.map(({ id, contribution }) => [id, contribution])).toEqual([
      ["child", "first/child"], ["inner", "first"], ["shell", "first"],
      ["child", "second/child"], ["inner", "second"], ["shell", "second"], ["root", "@recipe"],
    ]);
  });

  it("rejects missing, unknown and unpinned inputs", () => {
    const required = part({
      id: "part.required",
      version: "1",
      name: "Required",
      visibility: "shared",
      inputs: [{ name: "name", required: true }],
      payload: { files: { "x": "${name}" } },
    });
    const local: PartResolver = { get: () => required };
    const recipe = (contribution: unknown) => schema.PartRecipe.parse({ id: "recipe.inputs", contributions: [contribution] });
    expect(() => composeParts(recipe({ id: "x", part: { id: "part.required", version: "1" } }), local)).toThrow(/required input name/);
    expect(() => composeParts(recipe({ id: "x", part: { id: "part.required", version: "1" }, inputs: { typo: "x" } }), local)).toThrow(/unknown input typo/);
    expect(schema.PartRef.safeParse({ id: "part.required", version: "latest" }).success).toBe(false);
  });

  it("combines a collision only with the named contribution", () => {
    const combined = composeParts(schema.PartRecipe.parse({
      id: "recipe.styles",
      contributions: [
        { id: "app", part: { id: "part.framework.astro", version: "1.0.0" }, files: { rename: { "src/Button.ts": "src/theme.css" }, include: ["src/Button.ts"] } },
        { id: "ui", part: { id: "part.ui.buttons", version: "2.1.0" }, files: { include: ["src/theme.css"] }, combinations: [{ kind: "file", path: "src/theme.css", contribution: "app", strategy: "append", separator: "/* next */" }] },
      ],
    }), resolver);
    expect(combined.files["src/theme.css"]).toBe("export const Button = 'astro'\n/* next */:root { color: blue }\n");
    expect(combined.provenance.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "src/theme.css", contribution: "ui", disposition: "combined", by: "app" }),
    ]));
  });

  it("rejects an advertised digest that does not match package content", () => {
    const original = part({ id: "part.integrity", version: "1", name: "Integrity", visibility: "shared", payload: { files: { "x": "one" } } });
    const changed = part({ ...original, digest: partDigest(original), payload: { files: { "x": "two" } } });
    expect(() => composeParts(schema.PartRecipe.parse({ id: "recipe.integrity", contributions: [{ id: "x", part: { id: "part.integrity", version: "1" } }] }), { get: () => changed })).toThrow(/digest mismatch/);
  });

  it("bounds nested composition work", () => {
    const recipe = schema.PartRecipe.parse({
      id: "recipe.limit",
      contributions: [
        { id: "one", part: { id: "part.feature.contact", version: "1.0.0" }, files: { rename: { "src/contact.ts": "one.ts" } } },
        { id: "two", part: { id: "part.feature.contact", version: "1.0.0" }, files: { rename: { "src/contact.ts": "two.ts" } } },
      ],
    });
    expect(() => composeParts(recipe, resolver, { maxContributions: 1 })).toThrow(/contribution limit/);
  });

  it("rejects unsafe payload and mapped paths", () => {
    expect(schema.PartPackage.safeParse({ id: "part.bad", version: "1", name: "Bad", visibility: "shared", payload: { files: { "../secret": "x" } } }).success).toBe(false);
    expect(schema.PartRecipe.safeParse({ id: "recipe.bad", contributions: [{ id: "x", part: { id: "part.feature.contact", version: "1.0.0" }, files: { rename: { "src/contact.ts": "/tmp/x" } } }] }).success).toBe(false);
  });
});

describe("extractPart", () => {
  it("excludes masked payload and leaves the source unchanged", () => {
    const source = {
      revision: "genome-abc",
      model: { "ontology.yaml": "name: Sam\n", "private.yaml": "secret: true\n" },
      files: { "src/index.ts": "export const owner = 'Sam'\n", ".env": "SECRET=x\n" },
    };
    const before = JSON.parse(JSON.stringify(source));
    const result = extractPart(schema.ExtractionRequest.parse({
      source,
      package: { id: "part.extracted.profile", version: "1.0.0", name: "Profile", visibility: "shared" },
      mask: { model: ["private.yaml"], files: [".env"] },
      generalize: [{ kind: "file", path: "src/index.ts", value: "Sam", input: "owner", default: "Friend" }],
    }));

    expect(result.part.payload).toEqual({
      model: { "ontology.yaml": "name: Sam\n" },
      files: { "src/index.ts": "export const owner = '${owner}'\n" },
    });
    expect(result.part.inputs).toEqual([{ name: "owner", default: "Friend", required: false }]);
    expect(result.provenance.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ".env", disposition: "excluded" }),
      expect.objectContaining({ path: "private.yaml", disposition: "excluded" }),
      expect.objectContaining({ path: "src/index.ts", disposition: "adapted" }),
    ]));
    expect(source).toEqual(before);
  });
});

describe("upgradeComposition", () => {
  it("takes new generated content when current is unchanged and preserves independent customization", () => {
    const result = upgradeComposition(schema.UpgradeRequest.parse({
      baseline: { model: {}, files: { "generated.ts": "v1", "custom.ts": "base" } },
      current: { model: {}, files: { "generated.ts": "v1", "custom.ts": "mine" } },
      next: { model: {}, files: { "generated.ts": "v2", "custom.ts": "base" } },
    }));
    expect(result.result.files).toEqual({ "generated.ts": "v2", "custom.ts": "mine" });
    expect(result.conflicts).toEqual([]);
  });

  it("preserves customized current content and reports divergent generated changes", () => {
    const result = upgradeComposition(schema.UpgradeRequest.parse({
      baseline: { model: {}, files: { "src/App.ts": "base" } },
      current: { model: {}, files: { "src/App.ts": "mine" } },
      next: { model: {}, files: { "src/App.ts": "theirs" } },
    }));
    expect(result.result.files["src/App.ts"]).toBe("mine");
    expect(result.conflicts).toEqual([{ kind: "file", path: "src/App.ts", baseline: "base", current: "mine", next: "theirs" }]);
  });
});

describe('canonical Part paths', () => {
  it.each(['src/./a.ts', '.', 'a\u0000.ts', '__proto__'])('rejects aliases and unsafe record keys: %s', (path) => {
    expect(schema.PartPackage.safeParse({id:'part.paths',version:'1',name:'Paths',visibility:'shared',payload:{files:Object.fromEntries([[path,'content']])}}).success).toBe(false);
  });
  it('preserves a filename that shadows an Object method during an upgrade', () => {
    const result = upgradeComposition(schema.UpgradeRequest.parse({baseline:{files:{}},current:{files:{}},next:{files:{constructor:'new'}}}));
    expect(result.result.files.constructor).toBe('new');
    expect(result.conflicts).toEqual([]);
    const removed = upgradeComposition(schema.UpgradeRequest.parse({baseline:{files:{constructor:'old'}},current:{files:{}},next:{files:{}}}));
    expect(removed.result.files).toEqual({});
    expect(removed.conflicts).toEqual([]);
  });
});
