import { useReadiness } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import styles from "./GapsSummary.module.css";

const GLYPH = { error: "✕", missing: "○", warning: "!", info: "i" } as const;

/** Readiness findings about the theory and purpose (`theory.*`, `purpose.*`), each linked to its subject. */
export function GapsSummary() {
  const { data, isPending, isError } = useReadiness();
  const findings = (data?.modelReadiness.findings ?? []).filter((f) => f.rule.startsWith("theory.") || f.rule.startsWith("purpose."));
  return (
    <section className={styles.gaps} aria-labelledby="gaps-title">
      <h2 id="gaps-title" className={styles.title}>
        Theory gaps{!isPending && !isError && ` (${findings.length})`}
      </h2>
      {isPending ? (
        <p className={styles.note}>Loading findings.</p>
      ) : isError ? (
        <p className={styles.note}>Findings are unavailable, so gaps are unknown.</p>
      ) : findings.length === 0 ? (
        <p className={styles.note}>No theory or purpose findings were reported.</p>
      ) : (
        <ul className={styles.list}>
          {findings.map((f, i) => (
            <li key={`${f.rule}:${f.subject ?? ""}:${i}`} className={styles.item} data-level={f.level}>
              <span className={styles.level}>
                <span aria-hidden="true">{GLYPH[f.level]}</span> {f.level}
              </span>
              <code className={styles.rule}>{f.rule}</code>
              <span className={styles.message}>{f.message}</span>
              {f.subject && <NodeChip id={f.subject} size="sm" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
