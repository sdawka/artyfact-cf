/**
 * Test helper: a v2 Genome tree (`node.yaml` per directory) loaded with the bundled templates and shaped like the
 * model wire the SPA reads (`UiBundle`, `views` included), so views can be rendered against any template's kinds.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadGenome } from "@artyfact/model";
import { metaTemplates } from "@artyfact/templates";
import type { ModelJson, UiBundle } from "@/model/types";
import { modelViews } from "../../worker/model-bundle";

function readTree(root: string, dir = root, files = new Map<string, string>()) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readTree(root, p, files);
    else if (/\.ya?ml$/.test(name)) files.set(relative(root, p), readFileSync(p, "utf8"));
  }
  return files;
}

export function bundleFromGenomeTree(dir: string): UiBundle {
  const m = loadGenome(readTree(dir), { revision: "head", templates: metaTemplates });
  const { index: _index, templates: _templates, graph: _graph, template, ...rest } = m;
  const model = JSON.parse(JSON.stringify({ ...rest, views: modelViews(template) })) as ModelJson;
  return {
    systemId: m.system.id,
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
