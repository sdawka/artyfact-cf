import type { UiVerdict } from "@/model/status";
import styles from "./decision.module.css";

const ORDER: UiVerdict[] = ["pass", "fail", "stale", "unknown", "not-run", "waived"];
const GLYPH: Record<UiVerdict, string> = { pass: "✓", fail: "×", unknown: "?", stale: "↻", "not-run": "–", waived: "⊘" };

/** Counts per verdict, in the summary order ("4 pass · 1 unknown"). */
export function verdictCounts(verdicts: readonly UiVerdict[]): [UiVerdict, number][] {
  return ORDER.map((v) => [v, verdicts.filter((x) => x === v).length] as [UiVerdict, number]).filter(([, n]) => n > 0);
}

/**
 * "✓ 4 pass · ? 1 unknown": every verdict with its glyph and count. The success tone only when every one passes, the
 * danger tone when any fails, else neutral. `chip` borders it (a header's status); `text` is inline (a row, a group head).
 */
export function VerdictSummary({ verdicts, variant = "chip", testId, empty = "no evaluations" }: {
  verdicts: readonly UiVerdict[];
  variant?: "chip" | "text";
  testId?: string;
  /** Text when there is nothing to count. */
  empty?: string;
}) {
  const counts = verdictCounts(verdicts);
  const allPass = verdicts.length > 0 && verdicts.every((v) => v === "pass");
  const tone = allPass ? "pass" : verdicts.includes("fail") ? "fail" : undefined;
  return (
    <span className={variant === "chip" ? styles.summaryChip : styles.summaryText} data-tone={tone} data-testid={testId}>
      {counts.length
        ? counts.map(([v, n], i) => (
            <span key={v} className={styles.summaryPart} data-verdict-count={v}>
              {i > 0 && <span className={styles.summarySep} aria-hidden="true"> · </span>}
              <span aria-hidden="true">{GLYPH[v]}</span> {n} {v}
            </span>
          ))
        : empty}
    </span>
  );
}
