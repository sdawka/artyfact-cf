/**
 * Test helper: a v2 Genome tree (`node.yaml` per directory) as the model wire the SPA reads (`UiBundle`), so views can
 * be rendered against any template's kinds before the API serves v2 Genomes.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseNodeFile } from "@artyfact/ontology";
import type { ModelJson, UiBundle } from "@/model/types";

const LISTS = ["refines", "states", "roles", "preconditions", "effects", "failure", "fields", "invariants"] as const;

export function bundleFromGenomeTree(dir: string): UiBundle {
  const read = (path: string) => parseNodeFile(parseYaml(readFileSync(join(path, "node.yaml"), "utf8")));
  const root = read(dir);
  const things: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const walk = (path: string, parent: string) => {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name);
      if (name.startsWith(".") || !statSync(child).isDirectory() || !readdirSync(child).includes("node.yaml")) continue;
      const n = read(child);
      const f = (n.fields ?? {}) as Record<string, unknown>;
      const name_ = String(f.name ?? f.statement ?? f.title ?? n.id);
      if (n.kind === "thing") {
        things.push({ id: n.id, name: name_, description: f.description, templateRef: n.template ?? null, artifacts: [], purposeRefs: [], sections: [] });
      } else {
        nodes.push({
          ...Object.fromEntries(LISTS.map((k) => [k, []])),
          ...f,
          id: n.id, kind: n.kind, name: name_, parent, revision: 1, ...(n.template && { template: n.template }),
          links: (n.links ?? []).map((l) => ({ rel: l.rel, to: l.to, direction: "out", certainty: l.certainty ?? "declared" })),
        });
      }
      walk(child, n.id);
    }
  };
  walk(dir, root.id);
  const f = (root.fields ?? {}) as Record<string, unknown>;
  const model = {
    revision: "head",
    system: { id: root.id, name: String(f.name ?? root.id), template: root.template ?? null, things: things.map((t) => t.id), phase: "unrealized", purposes: [] },
    purposes: [], externals: [], claims: [], kits: { kits: [], rulePacks: [], required: [] }, things, nodes,
    requirements: [], criteria: [], hooks: [], journeys: [], evolutions: [], warnings: [], origin: {},
  } as unknown as ModelJson;
  return {
    systemId: root.id,
    revision: "head",
    genomeCommit: "0".repeat(40),
    model,
    readiness: {
      modelReadiness: { findings: [], blockers: [] },
      implementationConformance: { pass: 0, fail: 0, unknown: 0, stale: 0, notRun: 0 },
      outcomeProgress: { observed: 0, unknown: 0 },
      computedAt: "1970-01-01T00:00:00.000Z",
    },
    source: "fixture",
  } as unknown as UiBundle;
}
