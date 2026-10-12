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
