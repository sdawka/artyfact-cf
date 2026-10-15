import type { ChipTone } from "../StatusChip/StatusChip";
import styles from "./StatusText.module.css";

export interface StatusTextProps {
  /** Machine status, set as `data-status`. */
  status: string;
  /** Visible word; defaults to `status`. */
  label?: string;
  /** `attention` apricot (waits on you), `fail` danger, `pass` success (only for `pass` / `passed`), `neutral` subtle. */
  tone?: ChipTone;
  /** One decorative glyph (`aria-hidden`); defaults by tone: ◔ attention, × fail, ✓ pass, ○ neutral. `""` for none. */
  glyph?: string;
  title?: string;
}

const SUCCESS = new Set(["passed", "pass"]);
const GLYPH: Record<ChipTone, string> = { attention: "◔", fail: "×", pass: "✓", neutral: "○" };

/** Inline status in a row: glyph + word in the tone colour, no border (StatusChip is for headers). */
export function StatusText({ status, label, tone = "neutral", glyph, title }: StatusTextProps) {
  const safe: ChipTone = tone === "pass" && !SUCCESS.has(status) ? "neutral" : tone;
  const g = glyph ?? GLYPH[safe];
  return (
    <span className={styles.status} data-status={status} data-tone={safe} title={title}>
      {g && <span className={`u-glyph ${styles.glyph}`} aria-hidden="true">{g}</span>}
      {label ?? status}
    </span>
  );
}
