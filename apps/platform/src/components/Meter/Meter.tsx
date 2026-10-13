import styles from "./Meter.module.css";

export type MeterTone = "pass" | "fail" | "warn" | "subtle";

export interface MeterSegment {
  key: string;
  label: string;
  count: number;
  tone: MeterTone;
}

export interface MeterProps {
  /** What is measured, e.g. "Model readiness". */
  title: string;
  /** The question this meter answers (the layer's question on the rail), shown quietly under the title. */
  question?: string;
  /** The one-word reading, or the literal "unknown". Never a combined score. */
  headline: string;
  /** Own scale: segment widths are relative to the sum of these counts only. */
  segments: MeterSegment[];
  /** What this meter is NOT (shown as a caption). */
  caption: string;
  /** Provenance line, e.g. "as of canonical, computed 2 minutes ago". */
  asOf?: string;
  /** Shown instead of a bar when there is nothing to count. */
  emptyText?: string;
  /** Hover or keyboard focus on the meter (makes it focusable). For decorative reactions only; the meter reads the same without. */
  onActivate?: (el: HTMLElement) => void;
}

const GLYPH: Record<MeterTone, string> = { pass: "✓", fail: "×", warn: "!", subtle: "–" };

/** Never-green: a zero count is not evidence, so a pass segment with nothing in it takes the neutral tone. */
const legendTone = (s: MeterSegment): MeterTone => (s.tone === "pass" && s.count === 0 ? "subtle" : s.tone);

/** Segmented count bar with a legend. Colour is never the only signal: each segment is listed with a glyph, word and count. */
export function Meter({ title, question, headline, segments, caption, asOf, emptyText = "nothing counted", onActivate }: MeterProps) {
  const total = segments.reduce((n, s) => n + s.count, 0);
  const nonZero = segments.filter((s) => s.count > 0);
  return (
    <section
      className={styles.meter}
      aria-label={title}
      {...(onActivate && {
        tabIndex: 0,
        onPointerEnter: (e: React.PointerEvent<HTMLElement>) => onActivate(e.currentTarget),
        onFocus: (e: React.FocusEvent<HTMLElement>) => onActivate(e.currentTarget),
      })}
    >
      <div className={styles.head}>
        <h3 className={styles.title}>{title}</h3>
        {question && <p className={styles.question} data-question="">{question}</p>}
      </div>
      <p className={styles.headline} data-unknown={headline === "unknown" || undefined}>{headline}</p>
      {total > 0 ? (
        <div className={styles.bar} aria-hidden="true">
          {nonZero.map((s) => (
            <span key={s.key} className={styles.seg} data-tone={s.tone} title={`${s.label}: ${s.count}`} style={{ flexGrow: s.count }} />
          ))}
        </div>
      ) : (
        <div className={styles.bar} data-empty="" aria-hidden="true" />
      )}
      {total > 0 ? (
        <ul className={styles.legend}>
          {segments.map((s) => {
            const tone = legendTone(s);
            return (
              <li key={s.key} className={styles.legendItem} data-tone={tone} data-zero={s.count === 0 || undefined}>
                <span aria-hidden="true" className={styles.glyph}>{GLYPH[tone]}</span>
                <span>{s.label}</span>
                <span className={styles.count}>{s.count}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.empty}>{emptyText}</p>
      )}
      <p className={styles.caption}>{caption}</p>
      {asOf && <p className={styles.asOf}>{asOf}</p>}
    </section>
  );
}
