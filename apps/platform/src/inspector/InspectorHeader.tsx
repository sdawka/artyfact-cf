import { useMemo } from "react";
import { Cross2Icon } from "@radix-ui/react-icons";
import { Link } from "react-router";
import { useTree } from "@/api/queries";
import { useCompactLayout } from "@/app/useCompactLayout";
import { CopyButton } from "@/components/CopyButton/CopyButton";
import { MetaLine } from "@/components/MetaLine/MetaLine";
import { StatusChip, type ChipTone } from "@/components/StatusChip/StatusChip";
import { StatusText } from "@/components/StatusText/StatusText";
import { Button, IconButton } from "@/components/ui";
import { emptyRollup, type Rollup } from "@/model/status";
import type { IndexEntry } from "@/model/index";
import { kindColour, summaryOf, titleOf, useKindView, useKindViews, VIEW_LABELS, type ViewName } from "@/model/kinds";
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
export const canDescribeChange = (entry: Pick<IndexEntry, "type">) => CHANGEABLE.has(entry.type);

/** The node's readiness verdict from its criteria rollup: only an all-pass node is green; nothing run is not-run. */
export function readiness(r: Rollup): { label: string; tone: ChipTone; status: string; glyph?: string } {
  const total = r.pass + r.fail + r.unknown + r.stale + r.notRun + r.waived;
  if (total === 0) return { label: "No criteria", tone: "neutral", status: "none" };
  if (r.fail > 0) return { label: `${r.fail} failing`, tone: "fail", status: "fail", glyph: "×" };
  if (r.pass === total) return { label: "All criteria pass", tone: "pass", status: "pass", glyph: "✓" };
  if (r.pass === 0 && r.unknown + r.stale === 0) return { label: "Not run", tone: "neutral", status: "not-run", glyph: "–" };
  return { label: `${r.pass} of ${total} pass`, tone: "neutral", status: "partial", glyph: "–" };
}

/** Verdict counts over the criteria the node inherits from its ancestors (the Rules tab lists them as "inherited from ancestor"). */
export function inheritedRollup(m: ReturnType<typeof useModel>, id: string): Rollup {
  const out = emptyRollup();
  const key = { pass: "pass", fail: "fail", unknown: "unknown", stale: "stale", "not-run": "notRun", waived: "waived" } as const;
  const seen = new Set<string>();
  for (const a of m.path(id).slice(0, -1)) {
    for (const c of m.criteriaFor(a.id)) {
      if (c.deferred || seen.has(c.id)) continue;
      seen.add(c.id);
      out[key[m.verdictOf(c.id)]]++;
    }
  }
  return out;
}

/** Readiness with inherited criteria counted when the node has none of its own; those read "inherited". */
export function readinessWithInherited(own: Rollup, inherited: Rollup): ReturnType<typeof readiness> {
  const mine = readiness(own);
  if (mine.status !== "none") return mine;
  const inh = readiness(inherited);
  return inh.status === "none" ? mine : { ...inh, label: `${inh.label}, inherited` };
}

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

export function InspectorHeader({ entry, onClose }: { entry: IndexEntry; onClose?: () => void }) {
  const m = useModel();
  const view = useKindView(entry.kind);
  const compact = useCompactLayout();
  // Under the name: the kind's summary field. A registered body lays out its own fields, summary included.
  const summary = useBody(entry) === NodeBody ? summaryOf(entry, view) : undefined;
  const { setFocus, clear } = useSelection();
  const { view: current } = useSystemRoute();
  const kinds = useKindViews();
  const trail = m.path(entry.id).slice(0, -1);
  const href = useKeepParams();
  const doc = (entry.item as { source?: { doc?: unknown } } | undefined)?.source?.doc;
  // Code opens the node's own `node.yaml` (its origin); else a Genome file mapped to it; else `source.doc`, a document id
  // the Code view resolves. The origin comes first: a directory's README.md maps to its node too, and sorts earlier.
  const tree = useTree({ repo: "genome" });
  const origin = m.index.model.origin?.[entry.id];
  const touching = useTouchingCandidates(entry, m);
  const verdict = readinessWithInherited(m.rollup(entry.id), inheritedRollup(m, entry.id));
  // A node a candidate touches opens in Review (where the decision is) instead of Work; the current view is never offered.
  const views = openInViews(entry, m).filter((v) => !(touching.ids.length && v === "work") && v !== current);
  const codePath = origin ?? tree.data?.files.find((f) => f.nodes?.includes(entry.id))?.path ?? (typeof doc === "string" ? doc : "");
  const showCode = codePath && current !== "code";
  const showReview = touching.ids.length > 0 && current !== "review";
  const close = onClose ?? clear;
  return (
    <header className={styles.header} data-inspector-header>
      {!compact && (
        <div className={styles.titleRow}>
          <h2 className={styles.title} tabIndex={-1} data-inspector-title>
            <span className={styles.glyph} style={kindColour(view)} aria-hidden="true">{view.glyph}</span>
            {titleOf(entry, view)}
            <span className="sr-only">, {view.label}</span>
          </h2>
          <IconButton label="Close inspector" variant="ghost" onClick={close}><Cross2Icon /></IconButton>
        </div>
      )}
      {summary && <p className={styles.summary} data-inspector-summary>{summary}</p>}
      <div className={styles.idRow}>
        <MetaLine items={[{ value: view.label }, { value: entry.id, code: true }]} />
        <CopyButton value={entry.id} label="Copy id" />
        <StatusChip status={verdict.status} label={verdict.label} tone={verdict.tone} glyph={verdict.glyph} title="Readiness of this node and everything inside it" />
      </div>
      {!compact && trail.length > 0 && (
        <nav aria-label="Containment path">
          <ol className={styles.trail}>
            {trail.map((e) => (
              <li key={e.id}><button type="button" className={styles.linkButton} onClick={() => setFocus(e.id)}>{titleOf(e, kinds.of(e.kind))}</button></li>
            ))}
          </ol>
        </nav>
      )}
      {touching.ids.length > 0 && (
        <p className={styles.touching} title={touching.ids.join(", ")}>
          <StatusText status="candidate" tone="attention" glyph="◧" label={`In ${touching.ids.length} candidate${touching.ids.length === 1 ? "" : "s"}${touching.ids.length > 1 ? ", overlapping" : ""}`} />
          {showReview && <Link to={href("review", touching.review)} aria-label="Open in Review">Open in Review</Link>}
        </p>
      )}
      <div className={styles.actions}>
        {CHANGEABLE.has(entry.type) && (
          <Button asChild variant="secondary"><Link to={href("work", { panel: "intent", anchor: entry.id })}>Describe a change</Link></Button>
        )}
        {(views.length > 0 || showCode) && (
          <p className={styles.openIn}>
            <span>Open in</span>
            {views.map((v) => (
              <button key={v} type="button" className={styles.linkButton} aria-label={`Open in ${VIEW_LABELS[v]}`} onClick={() => setFocus(entry.id, { view: v })}>{VIEW_LABELS[v]}</button>
            ))}
            {showCode && <Link to={href("code", { repo: "genome", path: codePath })} aria-label="Open in Code">Code</Link>}
          </p>
        )}
      </div>
    </header>
  );
}
