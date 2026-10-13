/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { loadGenome } from "../../worker/hooks/model-rules";
import { taskFootprint } from "../../worker/tasks/footprint";
import { appFiles, genomeFiles } from "../fixtures/genome";

const SELF_PREFIX = "../../../../genome/";
const selfRaw = import.meta.glob("../../../../genome/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const selfGenome = () => loadGenome(Object.fromEntries(Object.entries(selfRaw).map(([k, v]) => [k.slice(SELF_PREFIX.length), v])), "self");

describe("taskFootprint", () => {
  const m = loadGenome(genomeFiles, "r1");
  const tree = Object.keys(appFiles);

  it("expands the nodes' globs over the app head tree", () => {
    const f = taskFootprint({ model: m, nodes: ["screen.people"], tree, appCommit: "c1" });
    expect(f.globs).toContain("src/ui/people/**");
    expect(f.paths).toContain("src/ui/people/index.html");
    expect(f.paths).not.toContain("src/worker/routes/contacts.ts");
    expect(f.unmatched).not.toContain("src/ui/people/**");
    expect(f.entryFiles).toContainEqual({ path: "src/ui/people/index.html", certainty: "declared" });
    expect(f.appCommit).toBe("c1");
    expect(f.globs).toEqual([...f.globs].sort());
  });

  it("reports globs matching nothing as unmatched and proposed entry files", () => {
    const f = taskFootprint({ model: m, nodes: ["screen.people"], tree: tree.filter((p) => !p.startsWith("src/ui/")) });
    expect(f.unmatched).toContain("src/ui/people/**");
    expect(f.paths).not.toContain("src/ui/people/index.html");
    expect(f.entryFiles).toContainEqual({ path: "src/ui/people/**", certainty: "proposed" });
    expect(f).not.toHaveProperty("appCommit");
  });

  it("returns an empty footprint for unscoped nodes, never **", () => {
    const f = taskFootprint({ model: m, nodes: ["no.such.node"], tree });
    expect(f).toEqual({ globs: [], paths: [], unmatched: [], entryFiles: [] });
  });

  it("prefixes globs with the Thing root on the self-Genome", () => {
    const self = selfGenome();
    const f = taskFootprint({
      model: self,
      nodes: ["module.platform.packets"],
      tree: ["apps/platform/worker/packets/task-packet.ts", "worker/packets/task-packet.ts", "apps/cli/src/index.ts"],
    });
    expect(f.globs).toContain("apps/platform/worker/packets/**");
    expect(f.globs).not.toContain("worker/packets/**");
    expect(f.paths).toContain("apps/platform/worker/packets/task-packet.ts");
    expect(f.paths).not.toContain("worker/packets/task-packet.ts");
    expect(f.paths).not.toContain("apps/cli/src/index.ts");
  });
});
