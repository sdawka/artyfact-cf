import picomatch from "picomatch";
import { parse as parseYaml } from "yaml";

export interface SourceMapEntry { glob: string; nodes: string[]; origin: "template" | "repo" }

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v == null ? [] : [String(v)]);

/** Accepts `[{glob, nodes}]`, `{mappings: [...]}` or `{<glob>: <ids>}`. */
export function parseSourceMap(text: string | undefined): { glob: string; nodes: string[] }[] {
  if (!text?.trim()) return [];
  const raw = parseYaml(text) as unknown;
  const list = Array.isArray(raw) ? raw : (raw as { mappings?: unknown })?.mappings;
  if (Array.isArray(list)) {
    return list
      .filter((e): e is { glob: unknown; nodes: unknown } => !!e && typeof e === "object" && "glob" in e)
      .map((e) => ({ glob: String(e.glob), nodes: asList(e.nodes) }));
  }
  if (raw && typeof raw === "object") return Object.entries(raw).map(([glob, nodes]) => ({ glob, nodes: asList(nodes) }));
  return [];
}

/** Template defaults (with `$thing` rebased to the owning Thing) ∪ the repo's `source-map.yaml`. */
export function loadSourceMap(
  defaults: { glob: string; nodes: string[] }[] | undefined,
  thingId: string | undefined,
  repoText: string | undefined,
): SourceMapEntry[] {
  const rebase = (n: string) => (n === "$thing" && thingId ? thingId : n);
  return [
    ...(defaults ?? []).map((e) => ({ glob: e.glob, nodes: e.nodes.map(rebase), origin: "template" as const })),
    ...parseSourceMap(repoText).map((e) => ({ ...e, origin: "repo" as const })),
  ];
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
