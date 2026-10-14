import { RowList, Row } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { needsYou, type CardSummary } from "./signifiers";
import styles from "./home.module.css";

/** Where the row's link lands, as one word. */
const destination = (key: string) => {
  const kind = key.slice(key.lastIndexOf(":") + 1);
  return kind === "promote" ? "Promote" : kind === "agent" ? "Work" : kind === "behind" || kind === "failed" ? "Deployments" : "Review";
};

/** One row per decision waiting on a person across all Systems; one quiet line when there are none. */
export function NeedsYou({ systems }: { systems: readonly CardSummary[] }) {
  const rows = needsYou(systems);
  return (
    <Section title="Needs you" count={rows.length > 0 ? rows.length : undefined}>
      {rows.length === 0 ? (
        <p className={styles.quiet}>Nothing is waiting on you.</p>
      ) : (
        <RowList label="Needs you">
          {rows.map((r) => (
            <Row
              key={r.key}
              to={r.href}
              label={`${r.title}, ${r.text}`}
              title={r.title}
              tone={r.tone}
              status={<><StatusText status={r.tone} label={r.text} tone={r.tone} /><span className={styles.destination}>{destination(r.key)} ›</span></>}
            />
          ))}
        </RowList>
      )}
    </Section>
  );
}
