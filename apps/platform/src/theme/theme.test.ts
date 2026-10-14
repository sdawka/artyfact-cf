import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { COLOUR_TOKENS } from "@artyfact/ontology";

// Vitest processes imported CSS (and `?raw` yields ''), so read the sources from disk.
const read = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");
const [tokens, whimsy, utilities, reactflow, effects, index] = [
  "tokens.css", "whimsy.css", "utilities.css", "reactflow.css", "effects.css", "index.css",
].map((n) => read(n)) as [string, string, string, string, string, string];

const balanced = (css: string) => css.split("{").length === css.split("}").length;

const cssFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? cssFiles(p) : e.name.endsWith(".css") ? [p] : [];
  });

describe("theme css", () => {
  it("uses tokens only: no hex or rgb() colours in theme or module css", () => {
    const srcDir = join(import.meta.dirname, "..");
    const files = cssFiles(srcDir).filter((f) => f.includes("/theme/") || f.endsWith(".module.css"));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, f).not.toMatch(/\brgba?\(/);
    }
  });

  it("has balanced braces in every file", () => {
    for (const css of [tokens, whimsy, utilities, reactflow, effects, index]) {
      expect(balanced(css)).toBe(true);
    }
  });

  it("defines whimsy variables on :root, not on a data attribute", () => {
    expect(whimsy).toMatch(/:root\s*\{[^}]*--font-display:\s*"Alegreya", "Alegreya Fallback", Georgia, serif;/);
    expect(whimsy).toMatch(/--font-ui:\s*"Atkinson Hyperlegible Next", "Atkinson Fallback", "Trebuchet MS", system-ui, sans-serif;/);
    expect(whimsy).toMatch(/--font-code:\s*"Atkinson Hyperlegible Mono", ui-monospace/);
    expect(whimsy).not.toMatch(/html\[data-typography[^\n]*\{/);
    expect(whimsy).toMatch(/--color-brand-primary:\s*oklch\(0\.79 0\.125 60\)/);
  });

  it("defines a --kind-<token> colour for every view-hint colour, dark and light", () => {
    const kinds = read("kinds.css");
    const [dark, light] = kinds.split(':root[data-theme="light"]') as [string, string];
    for (const t of COLOUR_TOKENS) {
      expect(dark, t).toMatch(new RegExp(`--kind-${t}:\\s*oklch\\(`));
      expect(light, t).toMatch(new RegExp(`--kind-${t}:\\s*oklch\\(`));
    }
    expect(index).toContain('@import "./kinds.css"');
  });

  it("provides base tokens", () => {
    expect(tokens).toMatch(/--spacing-4:/);
    expect(tokens).toMatch(/--motion-duration-normal:\s*180ms/);
  });

  it("defines utilities and verdict tokens", () => {
    for (const sel of [".u-brackets", ".u-brackets--on", ".u-segments", ".u-marker"]) {
      expect(utilities).toContain(sel);
    }
    for (const v of ["pass", "fail", "unknown", "stale", "not-run"]) {
      expect(utilities).toContain(`--verdict-${v}:`);
    }
    expect(utilities).toMatch(/prefers-reduced-motion/);
  });

  it("imports in order", () => {
    const order = ["tokens", "whimsy", "utilities", "reactflow", "effects"].map((n) => index.indexOf(`./${n}.css`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("defines effect tokens from the palette, and the README allows glow with limits", () => {
    for (const t of ["--glow-accent", "--glow-success", "--glow-error", "--gradient-haze", "--shadow-glow-accent", "--shadow-glow-success", "--shadow-glow-error", "--motion-duration-ambient"]) {
      expect(effects).toMatch(new RegExp(`${t}:`));
    }
    expect(effects).toMatch(/--glow-accent:\s*oklch\(0\.79 0\.125 60 \//);
    expect(effects).toMatch(/prefers-reduced-motion[\s\S]*--motion-duration-ambient:\s*0ms/);
    const readme = read("README.md");
    expect(readme).toMatch(/Glow, gradients and haze are allowed/);
    expect(readme).toMatch(/focus rings win/);
    expect(readme).not.toMatch(/No gradients, glow/);
    for (const t of ["--surface-veil", "--surface-veil-strong", "--surface-wash", "--backdrop-veil", "--shadow-glow-accent-soft", "--shadow-glow-error-soft"]) {
      expect(effects).toMatch(new RegExp(`${t}:`));
    }
    expect(effects).toMatch(/prefers-reduced-motion[\s\S]*\.fx-flow \{ animation: none; \}/);
    expect(effects).toMatch(/\[data-effects="off"\] \.fx-flow/);
  });

  it("loads the self-hosted faces first, with metric-matched fallbacks", () => {
    const fonts = read("fonts.css");
    expect(index.trimStart().startsWith('@import "./fonts.css";')).toBe(true);
    for (const f of ["atkinson-next-v1", "atkinson-next-italic-v1", "atkinson-mono-v1", "alegreya-v1"]) {
      expect(fonts).toContain(`url("/fonts/${f}.woff2")`);
      expect(existsSync(join(PLATFORM, "public/fonts", `${f}.woff2`)), f).toBe(true);
    }
    expect(fonts.match(/font-display: swap/g)?.length).toBe(4);
    for (const fb of ["Atkinson Fallback", "Alegreya Fallback"]) {
      expect(fonts).toMatch(new RegExp(`font-family: "${fb}";[^}]*size-adjust: [\\d.]+%;[^}]*ascent-override`));
    }
    expect(readFileSync(join(PLATFORM, "index.html"), "utf8")).toMatch(/<link rel="preload" href="\/fonts\/atkinson-next-v1\.woff2" as="font" type="font\/woff2" crossorigin/);
    for (const app of [PLATFORM, SITE]) {
      expect(readFileSync(join(app, "public/_headers"), "utf8")).toMatch(/\/fonts\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/);
    }
  });

  it("ships byte-identical font files and fonts.css in both apps", () => {
    const dir = (app: string) => join(app, "public/fonts");
    const names = readdirSync(dir(PLATFORM)).sort();
    expect(names).toEqual(readdirSync(dir(SITE)).sort());
    expect(names.filter((n) => n.endsWith(".woff2")).length).toBe(4);
    for (const n of names) expect(readFileSync(join(dir(SITE), n)).equals(readFileSync(join(dir(PLATFORM), n))), n).toBe(true);
    expect(readFileSync(join(SITE, "src/styles/fonts.css"), "utf8")).toBe(read("fonts.css"));
  });

  it("keeps the :root token blocks identical between the platform and the site", () => {
    for (const name of ["tokens.css", "whimsy.css", "effects.css", "utilities.css"]) {
      const site = readFileSync(join(SITE, "src/styles", name), "utf8");
      expect(rootTokens(site), name).toEqual(rootTokens(read(name)));
      expect(rootTokens(read(name)).size, name).toBeGreaterThan(0);
    }
  });

  it("defines the role tokens: type scale, surfaces, palette deltas and selection", () => {
    const all = new Map([...rootTokens(whimsy), ...rootTokens(effects), ...rootTokens(utilities)]);
    for (const t of ["display", "display-2", "system", "h1", "h2", "h3", "body", "prose", "ui", "control", "meta", "hint", "code", "code-block", "numeric"]) {
      expect(all.has(`--type-${t}`), t).toBe(true);
    }
    for (const t of ["page", "well", "panel", "raised", "overlay"]) expect(all.has(`--surface-${t}`), t).toBe(true);
    expect(all.get("--color-text-subtle")).toBe("oklch(0.665 0.03 280)");
    for (const t of ["--color-border-faint", "--color-attention", "--color-link", "--color-link-underline", "--color-primary-disabled-bg",
      "--shadow-glow-selection", "--shadow-glow-status-fail", "--selection-rule-width", "--selection-surface", "--font-glyph"]) {
      expect(all.has(t), t).toBe(true);
    }
    expect(utilities).toContain(".u-selected");
  });

  it("keeps kind colours off the verdict hues (success 166, danger 25)", () => {
    const kinds = read("kinds.css").split(':root[data-theme="light"]')[0]!;
    const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    for (const [, name, c, h] of kinds.matchAll(/--kind-([a-z]+):\s*oklch\([\d.]+ ([\d.]+) ([\d.]+)\)/g)) {
      if (Number(c) < 0.05) continue;
      expect(hueGap(Number(h), 166.2), `${name} vs success`).toBeGreaterThanOrEqual(25);
      expect(hueGap(Number(h), 25.3), `${name} vs danger`).toBeGreaterThanOrEqual(25);
    }
  });
});

const PLATFORM = join(import.meta.dirname, "../..");
const SITE = join(PLATFORM, "../site");

/** Custom properties declared in `:root { … }` blocks (including inside media queries), comments dropped. */
function rootTokens(css: string): Map<string, string> {
  const out = new Map<string, string>();
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of src.matchAll(/(@media[^{]*\{\s*)?:root\s*\{([^}]*)\}/g)) {
    const scope = block[1] ? block[1].replace(/\s+/g, " ").trim() + " " : "";
    for (const m of block[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(scope + m[1], m[2]!.replace(/\s+/g, " ").trim());
  }
  return out;
}
