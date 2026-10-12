import { verdictTone, type UiVerdict } from "@/model/status";
import styles from "./VerdictBadge.module.css";

const GLYPH: Record<UiVerdict, string> = {
  pass: "✓", fail: "×", unknown: "?", stale: "↻", "not-run": "–", waived: "⊘",
};

/**
 * Glyph + word, never colour alone. Only `pass` uses `--verdict-pass`; `fail` uses
 * `--verdict-fail`; everything else is subtle, and `stale` adds a dashed border.
 */
export function VerdictBadge({ verdict, label }: { verdict: UiVerdict; label?: string }) {
  const tone = verdictTone(verdict);
  return (
    <span className={`u-verdict ${styles.badge}`} data-verdict={verdict} data-tone={tone}>
      <span aria-hidden="true">{GLYPH[verdict]}</span> {label ?? verdict}
    </span>
  );
}
