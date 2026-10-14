import type { Build } from "../../../shared/api";

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
