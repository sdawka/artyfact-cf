import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { loadMetaTemplate, metaTemplateRefs } from "@artyfact/templates";
import { ENTRY_TYPES } from "@/model/index";

/**
 * The UI never branches on a template node kind: labels, glyphs, colours, Map bands and Inspector fields come from the
 * templates' view hints (`docs/design/ontology.md` §3, `model/kinds.ts`). Banned: every kind a bundled template
 * declares, except the model's own object shapes (`ENTRY_TYPES`: system, thing, purpose, claim, journey, criterion, ...)
 * and the projected bookkeeping kinds (template, kit, artifact). Code may branch on those because they are object
 * types with their own model shape, routes and bodies, never to choose a label, glyph or colour. Scanned: app code
 * under src/. Not scanned: fixtures and fixture-mode sample data, and tests, which name kinds as data to exercise views.
 */
const STRUCTURAL = new Set<string>([...ENTRY_TYPES, "template", "kit", "artifact"]);
const KINDS = [...new Set(metaTemplateRefs().flatMap((r) => Object.keys(loadMetaTemplate(r).kinds)))].filter((k) => !STRUCTURAL.has(k));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const k = `(?:${KINDS.map(esc).join("|")})`;
/** A kind name as a string literal, or an id prefix (`"screen."`). */
const q = `["'\`]${k}\\.?["'\`]`;
const BRANCHES = [
  new RegExp(`case\\s+${q}`, "g"),
  new RegExp(`[!=]==?\\s*${q}`, "g"),
  new RegExp(`${q}\\s*[!=]==?`, "g"),
  // any call taking a kind first: register*("k"), .includes/.has/.get/.set("k"), startsWith("k.")
  new RegExp(`\\b\\w+\\(\\s*${q}`, "g"),
  // an array literal holding a kind, across lines: ["k", ...], new Set([\n "k" ])
  new RegExp(`\\[[^\\[\\]]*${q}[^\\[\\]]*\\]`, "g"),
];
/**
 * An object key that is a kind (`screen:`, `"screen":`); a table needs two of them in one `{ }`. A single-key table
 * (`{ screen: 1 }`) is not caught: accepted, since one key is indistinguishable from an ordinary object literal.
 */
const KEY = new RegExp(`(?:^|[{,])\\s*["']?(${k})["']?\\s*:`, "gm");

/** Hits in `src` (whole-file, so multi-line literals count), as `line: text`. */
export function branchesIn(src: string): string[] {
  const at = (i: number) => src.slice(0, i).split("\n").length;
  const out = BRANCHES.flatMap((re) => [...src.matchAll(re)].map((m) => `${at(m.index!)}: ${m[0].replace(/\s+/g, " ")}`));
  const keys = [...src.matchAll(KEY)];
  for (let i = 1; i < keys.length; i++) {
    const between = src.slice(keys[i - 1]!.index!, keys[i]!.index!);
    if (!/[{}]/.test(between.slice(1))) out.push(`${at(keys[i]!.index!)}: kind table { ${keys[i - 1]![1]}: …, ${keys[i]![1]}: … }`);
  }
  return out;
}

const root = import.meta.dirname;
const DATA = new Set(["views/work/intent/sample.ts"]);
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "fixtures" || e.name === "testing" ? [] : sources(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !DATA.has(relative(root, p)) ? [p] : [];
  });

describe("no kind switches", () => {
  it("bans every non-structural kind the bundled templates declare", () => {
    for (const kind of ["screen", "entity", "section", "endpoint", "durable-object", "module", "command", "page"]) expect(KINDS).toContain(kind);
    for (const kind of ["system", "thing", "journey", "claim", "criterion"]) expect(KINDS).not.toContain(kind);
  });

  it("recognises the branch forms it bans", () => {
    const banned = [
      'case "screen":', 'if (n.kind === "entity")', '"policy" !== kind', 'registerBody("operation", OperationBody);',
      'THEORY.has("binding")', '["screen", "component"].includes(kind)', 'id.startsWith("screen.")', 'map.set("endpoint", 1)',
      'const X = new Set([\n  "route",\n  "field",\n]);', 'const G = { screen: "▭", entity: "▦" };', 'const G = {\n  "module": 1,\n  "page": 2,\n};',
    ];
    for (const src of banned) expect(branchesIn(src), src).not.toEqual([]);
    for (const ok of ['const s = step.screen;', 'function f(component: Body, field: string) {}', 'x ? "page" : "pages"', 'if (e.type === "journey")']) {
      expect(branchesIn(ok), ok).toEqual([]);
    }
  });

  it("finds no branch on a template node kind in src/", () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(150);
    const hits = files.flatMap((f) => branchesIn(readFileSync(f, "utf8")).map((h) => `${relative(root, f)}:${h}`));
    expect(hits).toEqual([]);
  });
});
