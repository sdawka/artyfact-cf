import { describe, expect, it } from "vitest";
import { manifestExists } from "../../worker/hooks/manifest-exists";

const tree = [
  { path: "wrangler.jsonc", size: 120 },
  { path: "src/index.ts", size: 300 },
  { path: "package.json", size: 0 },
];

describe("manifest engine", () => {
  it("passes when every required file is present and non-empty", () => {
    const o = manifestExists(tree, { requiredFiles: "wrangler.jsonc, src/index.ts" });
    expect(o).toMatchObject({ execution: "completed", verdict: "pass" });
  });

  it("fails listing missing and empty files", () => {
    const o = manifestExists(tree, { requiredFiles: "wrangler.jsonc,src/index.ts,package.json,README.md" });
    expect(o.verdict).toBe("fail");
    expect(o.execution).toBe("completed");
    expect(o.observations).toEqual([{ missing: ["README.md"], empty: ["package.json"], required: 4 }]);
  });

  it("accepts a leading ./ in tree paths", () => {
    expect(manifestExists([{ path: "./a.ts", size: 1 }], { requiredFiles: "a.ts" }).verdict).toBe("pass");
  });

  it("is an error, not a pass, when the hook declares no required files", () => {
    const o = manifestExists(tree, {});
    expect(o).toMatchObject({ execution: "error", verdict: "unknown" });
    expect(JSON.stringify(o.observations)).toContain("requiredFiles");
  });
});
