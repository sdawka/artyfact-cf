import type { BuildSummary } from "../../../shared/api";
import { buildTone, StatusChip } from "@/components/StatusChip/StatusChip";
import styles from "./BuildChip.module.css";

const GLYPH: Record<string, string> = { passed: "✓", failed: "×", error: "!", running: "…", queued: "·" };

/** Build status of a candidate (the literal "unknown" when it has none) plus its preview link. */
export function BuildChip({ build }: { build?: BuildSummary | undefined }) {
  const status = build?.status ?? "unknown";
  return (
    <span className={styles.wrap}>
      <StatusChip status={status} label={`build ${status}`} tone={buildTone(build?.status)} glyph={GLYPH[status]} />
      {build?.url && <a className={styles.link} href={build.url} target="_blank" rel="noopener noreferrer">Preview</a>}
    </span>
  );
}
