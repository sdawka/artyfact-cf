/**
 * Task footprint (docs/design: Evolutions → Tasks): the app paths a task may write, derived from its nodes' source map
 * globs (the same `permittedGlobs` a task packet uses) expanded over the app head tree. Pure: the caller lists the tree.
 * An empty `globs` means the task is unscoped; the planner reports that as a problem, it never widens to `**`.
 */
import type { SystemModel } from "@artyfact/model";
import type { TaskFootprint } from "../../shared/api";
import { globMatch, permittedGlobs, sourceMapFor } from "../artifacts/source-map";
import { entryFiles } from "../packets/task-packet";

export interface FootprintInput { model: SystemModel; nodes: string[]; tree: string[]; appCommit?: string }

const kindOf = (m: SystemModel) => (id: string) => {
  const e = m.index.byId[id];
  return e?.type === "node" ? e.kind : e?.type;
};

/** Glob expansion per tree (a plan computes many footprints over one head tree). */
const expansions = new WeakMap<string[], Map<string, string[]>>();
function expand(tree: string[], glob: string): string[] {
  let memo = expansions.get(tree);
  if (!memo) expansions.set(tree, (memo = new Map()));
  let hits = memo.get(glob);
  if (!hits) memo.set(glob, (hits = tree.filter((p) => globMatch(glob, p))));
  return hits;
}

export function taskFootprint(i: FootprintInput): TaskFootprint {
  const m = i.model;
  const commit = i.appCommit !== undefined ? { appCommit: i.appCommit } : {};
  const sm = sourceMapFor(m);
  const globs = [...permittedGlobs(sm, i.nodes, (id) => m.index.path(id), kindOf(m))].sort();
  if (!globs.length) return { globs: [], paths: [], unmatched: [], entryFiles: [], ...commit };
  const paths = new Set<string>();
  const unmatched: string[] = [];
  for (const g of globs) {
    const hits = expand(i.tree, g);
    if (!hits.length) unmatched.push(g);
    for (const p of hits) paths.add(p);
  }
  return { globs, paths: [...paths].sort(), unmatched, entryFiles: entryFiles(sm, i.nodes, i.tree), ...commit };
}
