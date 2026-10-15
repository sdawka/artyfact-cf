import { Button } from "@/components/ui";
import { useMemo } from "react";
import { Link } from "react-router";
import type { Evolution, Realization } from "../../../shared/api";
import { useCandidates, useConflicts } from "@/api/queries";
import { MetaLine, type MetaItem } from "@/components/MetaLine/MetaLine";
import { KindGlyphs, NodeChip } from "@/components/NodeChip/NodeChip";
import { Row, RowList } from "@/components/RowList/RowList";
import { Section } from "@/components/Section/Section";
import { StatusChip } from "@/components/StatusChip/StatusChip";
import { StatusText } from "@/components/StatusText/StatusText";
import { useModel } from "@/model/useModel";
import { useKeepParams, useSelection } from "@/model/useSelection";
import { StartWorkPanel } from "./panels/StartWorkPanel";
import { RealizationRow } from "./RealizationRow";
import { aggregate, conflictsOf, mergeConflicts, STARTABLE, useNow, useParam, verdictStatus } from "./lib";
import type { EvolutionSignal } from "./useEvolutionSignals";
import styles from "./work.module.css";

/** States before an Evolution can take work; later states have no Start work to offer. */
const PRE_ACTIONABLE = new Set<string>(["proposed", "draft"]);

const NO_CONFLICTS: never[] = [];

/** The detail's primary by state: Start work (actionable, realizing), Promote in Review (a ready promotion), else none. */
export function evolutionPrimary(e: Evolution, signal: EvolutionSignal | undefined): "start" | "promote" | null {
  if (STARTABLE.has(e.state)) return "start";
  if (signal?.promotable) return "promote";
  return null;
}

/**
 * Detail pane for `?evolution=`: title and state, facts, intent, acceptance criteria, and each agent's attempt. Start
 * work (`?panel=start`) replaces the attempts. Decisions live on Review.
 */
export function EvolutionDetail({ evolution: e, realizations, signal, titleOf }: {
  evolution: Evolution;
  realizations: readonly Realization[];
  signal?: EvolutionSignal | undefined;
  titleOf(id: string): string;
}) {
  const m = useModel();
  const now = useNow(30_000);
  const href = useKeepParams();
  const { setFocus } = useSelection();
  const [panel, setPanel] = useParam("panel");
  const { data: cand } = useCandidates(e.id);
  const { data: global } = useConflicts();
  const conflicts = useMemo(() => mergeConflicts(cand?.conflicts, global), [cand?.conflicts, global]);
  const candidateOf = (r: Realization) => cand?.candidates.find((c) => c.realization === r.id || c.id === r.candidate);
  // Stable per-candidate arrays so RealizationRow's memo holds across refetches.
  const conflictsByCandidate = useMemo(() => {
    const out = new Map<string, ReturnType<typeof conflictsOf>>();
    for (const c of cand?.candidates ?? []) out.set(c.id, conflictsOf(conflicts, c.id));
    return out;
  }, [cand?.candidates, conflicts]);
  const mine = realizations.filter((r) => r.evolution === e.id);
  const verdicts = e.acceptanceCriteria.map((c) => m.verdictOf(c));
  const pass = verdicts.filter((v) => v === "pass").length;
  const primary = evolutionPrimary(e, signal);
  // An evaluated or selected attempt is a candidate Review can promote: offer the hand-off even before the desk is ready.
  const promotable = !!signal?.promotable || mine.some((r) => r.status === "evaluated" || r.status === "selected");
  const starting = panel === "start";
  const legacy = e.kind !== "genome-amendment";

  const meta: MetaItem[] = [
    { value: e.id, code: true },
    { label: "kind", value: legacy ? `legacy ${e.kind}` : "Genome Evolution" },
    { label: "risk", value: e.risk },
    ...(e.dependsOn.length ? [{ label: "after", value: e.dependsOn.map(titleOf).join(", ") }] : []),
  ];
  const promote = (variant: "primary" | "secondary") => (
    <Button asChild variant={variant}><Link to={href("review", { evolution: e.id, realization: null, panel: "promote" })}>Promote in Review</Link></Button>
  );

  return (
    <article className={styles.detail} aria-labelledby="evolution-detail-title">
      <header className={styles.detailHead}>
        <div className={styles.titleRow}>
          <h2 id="evolution-detail-title">
            {e.title} <StatusChip status={e.state} tone={signal?.awaiting ? "attention" : "neutral"} />
          </h2>
          <div className={styles.headActions}>
            {primary === "start" ? (
              <>
                {promotable && promote("secondary")}
                <Button variant={starting ? "secondary" : "primary"} aria-pressed={starting} onClick={() => setPanel(starting ? null : "start")}>Start work</Button>
              </>
            ) : (
              <>
                {PRE_ACTIONABLE.has(e.state) && <Button variant="secondary" reason="Start work opens once the Evolution is actionable.">Start work</Button>}
                {primary === "promote" ? promote("primary") : promotable && promote("secondary")}
              </>
            )}
          </div>
        </div>
        <MetaLine items={meta} />
        {e.intent && <p className={styles.intentFull}>{e.intent}</p>}
        {signal?.overlap && (
          <p className={styles.empty}>
            <StatusText status="overlap" tone="attention" glyph="≈" label={signal.overlapWith.length ? `overlaps with ${signal.overlapWith.map(titleOf).join(", ")}` : "overlap"} />
          </p>
        )}
      </header>

      <Section
        title="Acceptance criteria"
        headingLevel={3}
        count={e.acceptanceCriteria.length}
        actions={e.acceptanceCriteria.length ? <StatusText {...verdictStatus(aggregate(verdicts), `${pass}/${e.acceptanceCriteria.length} pass`)} /> : undefined}
      >
        {e.acceptanceCriteria.length ? (
          <KindGlyphs hidden>
            <RowList label="Acceptance criteria" density="compact">
              {e.acceptanceCriteria.map((c, i) => (
                <Row key={c} onSelect={() => setFocus(c)} title={<NodeChip id={c} size="sm" glyph={false} interactive={false} />} status={<StatusText {...verdictStatus(verdicts[i]!)} />} />
              ))}
            </RowList>
          </KindGlyphs>
        ) : (
          <p className={styles.empty}>No acceptance criteria. Promotion has no criterion gates.</p>
        )}
      </Section>

      {starting ? (
        <StartWorkPanel evolution={e} onBack={() => setPanel(null)} />
      ) : (
        <Section title={legacy ? "Legacy realizations" : "Attempts"} headingLevel={3} count={mine.length}>
          {mine.length ? (
            <ul className={styles.attempts} aria-label="Attempts">
              {mine.map((r) => {
                const c = candidateOf(r);
                return <RealizationRow key={r.id} realization={r} candidate={c} conflicts={(c && conflictsByCandidate.get(c.id)) || NO_CONFLICTS} now={now} />;
              })}
            </ul>
          ) : (
            <p className={styles.empty}>No one is working on this Evolution.{STARTABLE.has(e.state) ? " Start work hands an agent its Task Packet." : ""}</p>
          )}
        </Section>
      )}
    </article>
  );
}
