import styles from "./StatusChip.module.css";

export type ChipTone = "neutral" | "attention" | "fail" | "pass";

export interface StatusChipProps {
  /** Machine status, set as `data-status` (e.g. a build status). */
  status: string;
  /** Visible text; defaults to `status`. */
  label?: string;
  tone?: ChipTone;
  /** One decorative character before the label (`aria-hidden`); the label still carries the meaning. */
  glyph?: string;
  title?: string;
}

/** Statuses allowed in the success tone: a build that `passed` and an assay `pass`. */
const SUCCESS = new Set(["passed", "pass"]);

/**
 * Small bordered status tag: glyph + word, never colour alone. `tone="pass"` is honoured only for a
 * build `passed` (or an assay `pass`); any other status asking for it renders neutral.
 */
export function StatusChip({ status, label, tone = "neutral", glyph, title }: StatusChipProps) {
  const safeTone: ChipTone = tone === "pass" && !SUCCESS.has(status) ? "neutral" : tone;
  return (
    <span className={styles.chip} data-status={status} data-tone={safeTone} title={title}>
      {glyph && <span aria-hidden="true">{glyph}</span>}
      {label ?? status}
    </span>
  );
}

/** The tone for a build status: only `passed` is pass; `failed` / `error` are fail; the rest neutral. */
export function buildTone(status: string | undefined | null): ChipTone {
  if (status === "passed") return "pass";
  if (status === "failed" || status === "error") return "fail";
  return "neutral";
}
