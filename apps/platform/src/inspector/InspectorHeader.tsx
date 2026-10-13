import { useMemo } from "react";
import { Link } from "react-router";
import { useTree } from "@/api/queries";
import { Breadcrumbs } from "@/components/Breadcrumbs/Breadcrumbs";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { NodeChip } from "@/components/NodeChip/NodeChip";
import type { IndexEntry } from "@/model/index";
import { summaryOf, useKindView, VIEW_LABELS, type ViewName } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { useBody } from "./bodies/registry";
import { NodeBody } from "./NodeBody";
import { useKeepParams, useSelection, useSystemRoute } from "@/model/useSelection";
import { useCandidateTouches } from "@/views/map/overlays/useCandidateTouches";
import { useReviewQueue } from "@/views/review/useReviewQueue";
import styles from "./Inspector.module.css";

const THEORY = new Set(["purpose", "claim", "external", "feature", "commitment"]);
/** Genome nodes a described change can start from (Work `?panel=intent&anchor=`). */
const CHANGEABLE = new Set(["system", "thing", "node", "external"]);

/** Which "Open in" views make sense for an object. */
export function openInViews(entry: IndexEntry, m: ReturnType<typeof useModel>): ViewName[] {
  const out: ViewName[] = [];
  if (["system", "thing", "node", "external"].includes(entry.type)) out.push("map");
  if (entry.type === "journey" || entry.type === "step" || m.journeysFor(entry.id).length) out.push("journeys");
  if (THEORY.has(entry.type)) out.push("theory");
  if (entry.type === "evolution" || (m.index.model.evolutions ?? []).some((e) => e.affectedNodes.includes(entry.id))) out.push("work");
  return out;
}

/**
 * Candidates touching the node (or anything inside it): those selected in `?candidates=` plus every candidate waiting in
 * Review. With the first one's Review link (its Evolution and realization) when it is in the queue.
 */
function useTouchingCandidates(entry: IndexEntry, m: ReturnType<typeof useModel>): { ids: string[]; review: Record<string, string | null> } {
  const { candidates: selected } = useSelection();
  const selectedTouches = useCandidateTouches(selected);
  const queue = useReviewQueue();
  return useMemo(() => {
    const scope = new Set([entry.id, ...m.descendants(entry.id)]);
    const ids = new Set<string>();
    for (const [id, subjects] of selectedTouches) if (subjects.some((s) => scope.has(s))) ids.add(id);
    for (const c of queue.candidates) {
      if (c.state === "promoted" || c.state === "rejected") continue;
      if (c.changedSubjects.some((s) => scope.has(s))) ids.add(c.id);
    }
    const rows = queue.groups.flatMap((g) => g.rows);
    const row = rows.find((r) => r.candidateId && ids.has(r.candidateId));
    const review: Record<string, string | null> = row?.realization ? { evolution: row.evolution, realization: row.realization.id, panel: null } : {};
    return { ids: [...ids], review };
  }, [entry.id, m, selectedTouches, queue]);
}

export function InspectorHeader({ entry }: { entry: IndexEntry }) {
  const m = useModel();
  const view = useKindView(entry.kind);
  // Under the name: the kind's summary field. A registered body lays out its own fields, summary included.
  const summary = useBody(entry) === NodeBody ? summaryOf(entry, view) : undefined;
  const { setFocus, clear } = useSelection();
  const { view: current } = useSystemRoute();
  const path = m.path(entry.id).map((e) => e.id);
  const href = useKeepParams();
  const doc = (entry.item as { source?: { doc?: unknown } } | undefined)?.source?.doc;
  // Code opens the node's own `node.yaml` (its origin); else a Genome file mapped to it; else `source.doc`, a document id
  // the Code view resolves. The origin comes first: a directory's README.md maps to its node too, and sorts earlier.
  const tree = useTree({ repo: "genome" });
  const origin = m.index.model.origin?.[entry.id];
  const touching = useTouchingCandidates(entry, m);
  // A node a candidate touches opens in Review (where the decision is) instead of Work.
  const views = openInViews(entry, m).filter((v) => !(touching.ids.length && v === "work"));
  const codePath = origin ?? tree.data?.files.find((f) => f.nodes?.includes(entry.id))?.path ?? (typeof doc === "string" ? doc : "");
  return (
    <header className={styles.header}>
      <div className={styles.titleRow}>
        <h2 className={styles.title} tabIndex={-1} data-inspector-title>
          <NodeChip id={entry.id} interactive={false} />
        </h2>
        <button type="button" className={`u-brackets ${styles.close}`} onClick={clear} aria-label="Close inspector">
          Close
        </button>
      </div>
      {summary && <p className={styles.summary} data-inspector-summary>{summary}</p>}
      <div className={styles.idRow}>
        <span className={styles.muted}>{view.label}</span>
        <code className={styles.idCode}>{entry.id}</code>
        <CopyButton value={entry.id} label="Copy id" />
      </div>
      {path.length > 1 && <Breadcrumbs ids={path} label="Containment path" />}
      {touching.ids.length > 0 && (
        <p className={styles.touching} title={touching.ids.join(", ")}>
          <span aria-hidden="true">◧</span> in {touching.ids.length} candidate{touching.ids.length === 1 ? "" : "s"}
          {touching.ids.length > 1 && " · overlap"}
        </p>
      )}
      <div className={styles.openIn}>
        {views.map((v) => (
          <button
            key={v}
            type="button"
            className={`u-brackets ${styles.openButton}`}
            aria-current={v === current ? "page" : undefined}
            onClick={() => setFocus(entry.id, { view: v })}
          >
            Open in {VIEW_LABELS[v]}
          </button>
        ))}
        {touching.ids.length > 0 && (
          <Link className={`u-brackets ${styles.openButton}`} to={href("review", touching.review)}>
            Open in Review
          </Link>
        )}
        {CHANGEABLE.has(entry.type) && (
          <Link className={`u-brackets ${styles.openButton}`} to={href("work", { panel: "intent", anchor: entry.id })}>
            Change this…
          </Link>
        )}
        {codePath && (
          <Link className={`u-brackets ${styles.openButton}`} to={href("code", { repo: "genome", path: codePath })}>
            Open in Code
          </Link>
        )}
      </div>
    </header>
  );
}
