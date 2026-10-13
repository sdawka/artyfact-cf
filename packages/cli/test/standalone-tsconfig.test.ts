import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Every tsconfig.json under `dir`, skipping node_modules. */
function tsconfigs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules") return [];
    if (statSync(p).isDirectory()) return tsconfigs(p);
    return name === "tsconfig.json" ? [p] : [];
  });
}

// App repos are checked out alone by CI, so their tsconfig must not reach into the monorepo.
// The templates package itself is a monorepo package; only its scaffolded content is app-destined.
const appDirs = [
  ...readdirSync(join(ROOT, "examples")).filter((n) => n.endsWith("-app")).map((n) => join(ROOT, "examples", n)),
  ...["system", "thing", "rule-packs"].map((n) => join(ROOT, "packages/templates", n)),
];

describe("standalone app tsconfig", () => {
  it("finds the example app", () => expect(appDirs.some((d) => d.endsWith("peopling-app"))).toBe(true));
  for (const file of appDirs.flatMap(tsconfigs)) {
    it(`${relative(ROOT, file)} does not extend outside its directory`, () => {
      const { extends: ext } = JSON.parse(readFileSync(file, "utf8")) as { extends?: string | string[] };
      for (const e of [ext ?? []].flat()) {
        const target = resolve(dirname(file), e);
        expect(relative(dirname(file), target).startsWith("..")).toBe(false);
      }
    });
  }
});
