import { useReadiness } from "@/api/queries";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Row, RowList } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import styles from "./GapsSummary.module.css";

const GLYPH = { error: "✕", missing: "○", warning: "!", info: "i" } as const;
type Finding = NonNullable<ReturnType<typeof useReadiness>["data"]>["modelReadiness"]["findings"][number];

export type TheoryGaps =
  | { state: "loading" }
  | { state: "error"; retry: () => void }
  | { state: "ready"; findings: Finding[] };

/** Readiness findings about the theory and purpose (`theory.*`, `purpose.*`). */
export function useTheoryGaps(): TheoryGaps {
  const { data, isPending, isError, refetch } = useReadiness();
  if (isError) return { state: "error", retry: () => void refetch() };
  if (isPending) return { state: "loading" };
  return { state: "ready", findings: data.modelReadiness.findings.filter((f) => f.rule.startsWith("theory.") || f.rule.startsWith("purpose.")) };
}

/** The header's one-line gap status: never "(0)", and never a claim that the theory is sound. */
export function GapsStatus({ gaps }: { gaps: TheoryGaps }) {
  if (gaps.state === "loading") return <StatusText status="loading" label="Checking theory gaps" />;
  if (gaps.state === "error") return <StatusText status="unknown" label="Theory gaps unknown" tone="fail" />;
  const n = gaps.findings.length;
  if (n === 0) return <StatusText status="clear" label="No theory gaps reported" />;
  return <StatusText status="gaps" label={`${n} theory ${n === 1 ? "gap" : "gaps"}`} tone="attention" />;
}

/** Findings, each linked to its subject. Rendered only when there is something to say: more than zero, or a load failure. */
export function GapsSummary({ gaps }: { gaps: TheoryGaps }) {
  if (gaps.state === "loading" || (gaps.state === "ready" && gaps.findings.length === 0)) return null;
  if (gaps.state === "error") {
    return (
      <Section title="Theory gaps">
        <EmptyState kind="error" title="Could not load findings, so gaps are unknown." onRetry={gaps.retry} />
      </Section>
    );
  }
  return (
    <Section title="Theory gaps" count={gaps.findings.length}>
      <RowList label="Theory gaps">
        {gaps.findings.map((f, i) => (
          <Row
            key={`${f.rule}:${f.subject ?? ""}:${i}`}
            tone={f.level === "error" ? "fail" : "neutral"}
            title={f.message}
            meta={<><code className={styles.rule}>{f.rule}</code>{f.subject && <> <NodeChip id={f.subject} size="sm" /></>}</>}
            status={<StatusText status={f.level} tone={f.level === "error" ? "fail" : "neutral"} glyph={GLYPH[f.level]} />}
          />
        ))}
      </RowList>
    </Section>
  );
}
