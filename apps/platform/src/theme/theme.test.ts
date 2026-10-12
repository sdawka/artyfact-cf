import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Vitest processes imported CSS (and `?raw` yields ''), so read the sources from disk.
const read = (name: string) => readFileSync(join(import.meta.dirname, name), "utf8");
const [tokens, whimsy, utilities, reactflow, fonts, index] = [
  "tokens.css", "whimsy.css", "utilities.css", "reactflow.css", "fonts.css", "index.css",
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
    for (const css of [tokens, whimsy, utilities, reactflow, fonts, index]) {
      expect(balanced(css)).toBe(true);
    }
  });

  it("defines whimsy variables on :root, not on a data attribute", () => {
    expect(whimsy).toMatch(/:root\s*\{[^}]*--font-display:\s*"Brilon"/);
    expect(whimsy).not.toMatch(/html\[data-typography[^\n]*\{/);
    expect(whimsy).toMatch(/--color-brand-primary:\s*oklch\(0\.79 0\.125 60\)/);
  });

  it("provides base tokens", () => {
    expect(tokens).toMatch(/--spacing-4:/);
    expect(tokens).toMatch(/--motion-duration-normal:\s*180ms/);
  });

  it("declares Brilon with swap", () => {
    expect(fonts).toMatch(/font-family:\s*"Brilon"/);
    expect(fonts).toMatch(/font-display:\s*swap/);
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
    const order = ["tokens", "fonts", "whimsy", "utilities", "reactflow"].map((n) => index.indexOf(`./${n}.css`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
