import type { Build, Deployment, PhenomeEventsResponse } from "../../../shared/api";

/** "1 event", "2 events". */
export const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

export const short = (s?: string | null) => (s ? s.slice(0, 7) : "unknown");

/** `<time>` text: the ISO string trimmed to minutes, or the literal "unknown". */
export function stamp(iso?: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace("T", " ") + "Z" : "unknown";
}

export const BUILD_GLYPH: Record<string, string> = { passed: "✓", failed: "×", error: "!", running: "…", queued: "·" };

export const sortNewest = (builds: readonly Build[]): Build[] =>
  [...builds].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

/** "2m 3s" between two ISO times; undefined when either is missing or the order is wrong. */
export function duration(start?: string | null, end?: string | null): string | undefined {
  const a = start ? Date.parse(start) : NaN;
  const b = end ? Date.parse(end) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return undefined;
  const s = Math.round((b - a) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * A deployment record can lack its System commit (a CI-reported production build creates the deployment without one),
 * while its runtime events carry the System commit the platform derived from the same app commit. Fill the gap from the
 * event versions of that deployment, so the row and its events never disagree. A recorded System commit always wins.
 */
export function withSystemCommit(d: Deployment, versions: PhenomeEventsResponse["versions"]): Deployment {
  if (d.systemCommit) return d;
  const derived = versions.find((v) => v.deployment === d.id && v.commit === d.commit && v.systemCommit)?.systemCommit;
  return derived ? { ...d, systemCommit: derived } : d;
}
