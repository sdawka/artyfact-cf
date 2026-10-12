import type { TheoryClaim } from "@/model/types";
import styles from "./ClaimStatus.module.css";

const STATUS = {
  unknown: { glyph: "○", tone: "subtle" },
  inconclusive: { glyph: "◐", tone: "subtle" },
  supported: { glyph: "●", tone: "subtle" },
  challenged: { glyph: "✕", tone: "danger" },
} as const;

/** Claim status as glyph + word. Never green: a supported hypothesis is still a hypothesis. */
export function ClaimStatus({ status }: { status: TheoryClaim["status"] }) {
  const s = STATUS[status];
  return (
    <span className={styles.status} data-status={status} data-tone={s.tone}>
      <span aria-hidden="true">{s.glyph}</span> {status}
    </span>
  );
}
