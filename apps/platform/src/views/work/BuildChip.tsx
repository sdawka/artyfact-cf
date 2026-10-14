import type { BuildSummary } from "../../../shared/api";
import { buildTone, StatusChip } from "@/components/StatusChip/StatusChip";
import { StatusText } from "@/components/StatusText/StatusText";
import styles from "./BuildChip.module.css";

const GLYPH: Record<string, string> = { passed: "✓", failed: "×", error: "!", running: "…", queued: "·", unknown: "?" };

/**
 * Build status of a candidate (the literal "unknown" when it has none) plus its preview link. `text`: inline StatusText
 * for rows; the default bordered chip is for headers.
 */
export function BuildChip({ build, variant = "chip" }: { build?: BuildSummary | undefined; variant?: "chip" | "text" }) {
  const status = build?.status ?? "unknown";
  const props = { status, label: `build ${status}`, tone: buildTone(build?.status), glyph: GLYPH[status] ?? "" };
  return (
    <span className={styles.wrap}>
      {variant === "text" ? <StatusText {...props} /> : <StatusChip {...props} />}
      {build?.url && <a className={styles.link} href={build.url} target="_blank" rel="noopener noreferrer">Preview</a>}
    </span>
  );
}
