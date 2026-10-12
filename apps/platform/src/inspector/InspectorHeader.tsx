import { Breadcrumbs } from "@/components/Breadcrumbs/Breadcrumbs";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { IndexEntry } from "@/model/index";
import { kindInfo, VIEW_LABELS, type ViewName } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { useSelection, useSystemRoute } from "@/model/useSelection";
import styles from "./Inspector.module.css";

const THEORY = new Set(["purpose", "claim", "external", "feature", "commitment"]);

/** Which "Open in" views make sense for an object. */
export function openInViews(entry: IndexEntry, m: ReturnType<typeof useModel>): ViewName[] {
  const out: ViewName[] = [];
  if (["system", "thing", "node", "external"].includes(entry.type)) out.push("map");
  if (entry.type === "journey" || entry.type === "step" || m.journeysFor(entry.id).length) out.push("journeys");
  if (THEORY.has(entry.kind)) out.push("theory");
  if (entry.type === "evolution" || (m.index.model.evolutions ?? []).some((e) => e.affectedNodes.includes(entry.id))) out.push("work");
  return out;
}

export function InspectorHeader({ entry }: { entry: IndexEntry }) {
  const m = useModel();
  const { setFocus, clear } = useSelection();
  const { view } = useSystemRoute();
  const path = m.path(entry.id).map((e) => e.id);
  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>
          <NodeChip id={entry.id} interactive={false} />
        </h2>
        <button type="button" className={`u-brackets ${styles.close}`} onClick={clear} aria-label="Close inspector">
          Close
        </button>
      </div>
      <div className={styles.idRow}>
        <span className={styles.muted}>{kindInfo(entry.kind).label}</span>
        <code className={styles.idCode}>{entry.id}</code>
        <CopyButton value={entry.id} label="Copy id" />
      </div>
      {path.length > 1 && <Breadcrumbs ids={path} label="Containment path" />}
      <div className={styles.openIn}>
        {openInViews(entry, m).map((v) => (
          <button
            key={v}
            type="button"
            className={`u-brackets ${styles.openButton}`}
            aria-current={v === view ? "page" : undefined}
            onClick={() => setFocus(entry.id, { view: v })}
          >
            Open in {VIEW_LABELS[v]}
          </button>
        ))}
      </div>
    </header>
  );
}
