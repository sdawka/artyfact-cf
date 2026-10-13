import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/bootstrap.sh", import.meta.url));

describe("scripts/bootstrap.sh", () => {
  it("is a valid two-line wrapper over artyfact init for the examples layout", () => {
    expect(spawnSync("bash", ["-n", script]).status).toBe(0);
    const lines = readFileSync(script, "utf8").trim().split("\n").filter((l) => !l.startsWith("#"));
    expect(lines).toEqual([`cd "$(dirname "$0")/.." && exec npx --no-install artyfact init --genome examples/peopling-system --app examples/peopling-app "$@"`]);
  });

  it("puts nothing token-bearing on an argv", () => {
    expect(readFileSync(script, "utf8").split("\n").filter((l) => /env .*GIT_CONFIG|git -c|Bearer/.test(l))).toEqual([]);
  });
});
