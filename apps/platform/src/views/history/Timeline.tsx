import { useEffect, useRef } from "react";
import { CommitCard, type CommitView } from "./CommitCard";
import styles from "./history.module.css";

/** Newest-first vertical list of commits; the highlighted one is scrolled into view. */
export function Timeline({ commits, highlight }: { commits: readonly CommitView[]; highlight?: string | null }) {
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!highlight) return;
    list.current?.querySelector<HTMLElement>(`#commit-${CSS.escape(highlight)}`)?.scrollIntoView({ block: "center" });
  }, [highlight]);
  return (
    <ol ref={list} className={styles.timeline} aria-label="System commits, newest first">
      {commits.map((c) => (
        <li key={c.id} className={styles.item}>
          <CommitCard commit={c} highlighted={c.id === highlight} />
        </li>
      ))}
    </ol>
  );
}
