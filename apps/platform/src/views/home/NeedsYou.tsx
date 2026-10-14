import { RowList, Row } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { needsYou, type CardSummary, type LedgerRow } from "./signifiers";
import styles from "./home.module.css";

/** Where the row's link lands, as one word. */
const destination = (key: string) => {
  const kind = key.slice(key.lastIndexOf(":") + 1);
  return kind === "promote" ? "Promote" : kind === "agent" ? "Work" : kind === "behind" || kind === "failed" ? "Deployments" : "Review";
};

/** One entry per System with something waiting on a person (a System with several reasons lists them under its name); one quiet line when there are none. */
export function NeedsYou({ systems }: { systems: readonly CardSummary[] }) {
  const rows = needsYou(systems);
  const groups: LedgerRow[][] = [];
  for (const r of rows) {
    const g = groups.find((x) => x[0]!.systemId === r.systemId);
    if (g) g.push(r);
    else groups.push([r]);
  }
  return (
    <Section title="Needs you" count={groups.length > 0 ? groups.length : undefined}>
      {groups.length === 0 ? (
        <p className={styles.quiet}>Nothing is waiting on you.</p>
      ) : (
        <RowList label="Needs you">
          {groups.map((g) =>
            g.length === 1 ? (
              <Row
                key={g[0]!.key}
                to={g[0]!.href}
                label={`${g[0]!.title}, ${g[0]!.text}`}
                title={g[0]!.title}
                tone={g[0]!.tone}
                status={<><StatusText status={g[0]!.tone} label={g[0]!.text} tone={g[0]!.tone} /><span className={styles.destination}>{destination(g[0]!.key)} ›</span></>}
              />
            ) : (
              <li key={g[0]!.systemId} className={styles.ledgerGroup}>
                <p className={styles.ledgerHead}>{g[0]!.title}</p>
                <RowList label={`${g[0]!.title} needs you`}>
                  {g.map((r) => (
                    <Row
                      key={r.key}
                      to={r.href}
                      label={`${r.title}, ${r.text}`}
                      title={<StatusText status={r.tone} label={r.text} tone={r.tone} />}
                      status={<span className={styles.destination}>{destination(r.key)} ›</span>}
                    />
                  ))}
                </RowList>
              </li>
            ),
          )}
        </RowList>
      )}
    </Section>
  );
}
