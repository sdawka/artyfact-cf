import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The UI never branches on a concrete kind name: labels, glyphs, colours, Map bands and Inspector fields come from the
 * templates' view hints (`docs/design/ontology.md` §3, `model/kinds.ts`). Fixtures are data and are skipped.
 */
const KINDS = ["screen", "component", "affordance", "entity", "operation", "policy", "binding", "route", "field", "grouping"];
const k = `(?:${KINDS.join("|")})`;
const q = `["'\`]${k}["'\`]`;
const BRANCHES = [
  new RegExp(`case\\s+${q}`),
  new RegExp(`[!=]==?\\s*${q}`),
  new RegExp(`${q}\\s*[!=]==?`),
  new RegExp(`register\\w*\\(\\s*${q}`),
  new RegExp(`\\.(?:has|includes|get)\\(\\s*${q}`),
  new RegExp(`new Set\\(\\[[^\\]]*${q}`),
  new RegExp(`^\\s*${k}\\s*:\\s*\\{`),
];

const root = import.meta.dirname;
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "fixtures" ? [] : sources(p);
    return /\.tsx?$/.test(e.name) && p !== join(root, "no-kind-switch.test.ts") ? [p] : [];
  });

describe("no kind switches", () => {
  it("recognises the branch forms it bans", () => {
    const banned = ['case "screen":', 'if (n.kind === "entity")', '"policy" !== kind', 'registerBody("operation", OperationBody);',
      'THEORY.has("binding")', 'const X = new Set(["route", "field"]);', '  grouping: { glyph: "⬚", label: "Grouping" },'];
    for (const line of banned) expect(BRANCHES.some((re) => re.test(line)), line).toBe(true);
    expect(BRANCHES.some((re) => re.test('const s = step.screen; // a journey step field'))).toBe(false);
  });

  it("finds no branch on a concrete kind name in src/", () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((line, i) =>
        BRANCHES.some((re) => re.test(line)) ? [`${relative(root, f)}:${i + 1}: ${line.trim()}`] : [],
      ),
    );
    expect(hits).toEqual([]);
  });
});
