import { useState } from "react";
import { Link } from "react-router";
import { useViewportWidth } from "@/app/useCompactLayout";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { Section } from "@/components/Section/Section";
import { StatusText } from "@/components/StatusText/StatusText";
import { Tabs } from "@/components/Tabs/Tabs";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { ClaimList } from "./ClaimList";
import { GapsStatus, GapsSummary, useTheoryGaps } from "./GapsSummary";
import { LogicModel } from "./LogicModel";
import styles from "./TheoryView.module.css";

type Mode = "list" | "grid";
const MODES = [{ id: "list", label: "List" }, { id: "grid", label: "Grid" }] as const;
/** The five-column grid needs room; below this the claim list is the only reading. */
const GRID_MIN = 1280;

export default function TheoryView() {
  const { purposes, claims } = useModel().bundle.model;
  const systemName = useModel().index.model.system.name;
  const href = useKeepParams();
  const gaps = useTheoryGaps();
  const [picked, setMode] = useState<Mode>("list");
  const wide = useViewportWidth() >= GRID_MIN;
  const mode: Mode = wide ? picked : "list";
  const unknown = claims.filter((c) => c.status === "unknown").length;
  return (
    <section className={styles.view} aria-labelledby="view-title">
      <PageHeader
        title="Theory"
        purpose={`Why ${systemName} should work. Hypotheses, not a validated causal model.`}
        status={<>
          <StatusText status="claims" label={`${claims.length} ${claims.length === 1 ? "claim" : "claims"}`} glyph="" />
          {claims.length > 0 && <StatusText status="unknown" label={`${unknown} unknown`} />}
          <GapsStatus gaps={gaps} />
        </>}
      />
      {purposes.length > 0 && (
        <Section title="Purpose" surface="panel" className={styles.purpose}>
          {purposes.map((p) => (
            <div key={p.id} className={styles.statement}>
              <p>{p.statement}</p>
              {p.successCriteria.length > 0 && <>
                <p className={styles.label}>Success criteria</p>
                <ul>{p.successCriteria.map((s) => <li key={s}>{s}</li>)}</ul>
              </>}
            </div>
          ))}
        </Section>
      )}
      <Section
        title="Claims" count={claims.length}
        actions={wide ? <Tabs<Mode> tabs={MODES} value={mode} onChange={setMode} label="Claims view" /> : undefined}
      >
        {claims.length === 0 ? (
          <EmptyState title="No claims yet." action={<Link to={href("work", { panel: "intent" })}>Describe a change</Link>}>
            Claims are hypotheses about how {systemName} reaches its purpose; add them in a change.
          </EmptyState>
        ) : mode === "grid" ? (
          <div className={styles.scroll} tabIndex={0} role="region" aria-label="Logic model, scrolls horizontally">
            <LogicModel purposes={purposes} claims={claims} />
          </div>
        ) : (
          <ClaimList claims={claims} />
        )}
      </Section>
      <GapsSummary gaps={gaps} />
    </section>
  );
}
