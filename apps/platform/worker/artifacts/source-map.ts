import type { SystemModel } from "@artyfact/model";
import picomatch from "picomatch";

/**
 * One glob of the node-attached source map (docs/design/ontology.md §3) and the nodes it realises. `node` globs are
 * declared in a node's own `files`; `template` globs are kind, prefilled-node or template-root defaults.
 */
export interface SourceMapEntry { glob: string; nodes: string[]; origin: "template" | "node" }

/** The source map of a Genome: every tree node's effective globs (`SystemModel.files`), grouped by glob. */
export function sourceMapFor(m: Pick<SystemModel, "files">): SourceMapEntry[] {
  const entries = new Map<string, SourceMapEntry>();
  for (const [id, globs] of Object.entries(m.files)) {
    for (const { glob, declared } of globs) {
      const origin = declared ? "node" : "template";
      const key = `${origin}\0${glob}`;
      const e = entries.get(key) ?? { glob, nodes: [], origin };
      e.nodes.push(id);
      entries.set(key, e);
    }
  }
  return [...entries.values()];
}

const matchers = new Map<string, (p: string) => boolean>();
export function globMatch(glob: string, path: string): boolean {
  let m = matchers.get(glob);
  if (!m) {
    m = picomatch(glob, { dot: true });
    matchers.set(glob, m);
  }
  return m(path);
}

export function nodesForPath(sm: SourceMapEntry[], path: string): string[] {
  const hits = [...new Set(sm.filter((e) => globMatch(e.glob, path)).flatMap((e) => e.nodes))];
  return hits.length ? hits : [`unmapped:${path}`];
}

/**
 * Globs an agent may edit for `affected` nodes: entries naming an affected node or one of its
 * containment ancestors below the Thing (System/Thing roots would permit everything).
 */
export function permittedGlobs(
  sm: SourceMapEntry[],
  affected: string[],
  pathOf: (id: string) => string[],
  kindOf: (id: string) => string | undefined,
): string[] {
  const allowed = new Set<string>();
  for (const id of affected) {
    for (const p of pathOf(id)) {
      const k = kindOf(p);
      if (k !== "system" && k !== "thing") allowed.add(p);
    }
    allowed.add(id);
  }
  return [...new Set(sm.filter((e) => e.nodes.some((n) => allowed.has(n))).map((e) => e.glob))];
}
