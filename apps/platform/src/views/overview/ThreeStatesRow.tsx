import { useReadiness } from "@/api/queries";
import { Meter } from "@/components/Meter/Meter";
import { useModel } from "@/model/useModel";
import { conformanceMeter, outcomeMeter, readinessMeter, relativeTime, shortRev } from "./states";
import styles from "./Overview.module.css";

/** Three separate meters, each on its own scale. They are never summed or averaged. */
export function ThreeStatesRow({ onMeter }: { onMeter?: (el: HTMLElement) => void } = {}) {
  const m = useModel();
  const { data } = useReadiness();
  const report = data ?? m.bundle.readiness;

  const readiness = readinessMeter(report);
  const thingCriteria = (m.index.model.criteria ?? []).filter((c) => c.ownerKind === "thing" && !c.deferred);
  const conformance = conformanceMeter(thingCriteria.map((c) => m.verdictOf(c.id)));
  const outcome = outcomeMeter(m.index.model.claims);

  const inScope = new Set(m.scope.candidates);
  const finished = m.evaluations
    .filter((e) => inScope.has(e.candidate) && e.finishedAt)
    .map((e) => e.finishedAt!)
    .sort();
  const latest = finished.at(-1);
  const rev = shortRev(m.bundle.revision);

  return (
    <section aria-labelledby="states-title" className={styles.states}>
      <h2 id="states-title" className={styles.cardTitle}>Three states</h2>
      <p className={styles.muted}>Reported side by side. No combined score exists.</p>
      <div className={styles.meters}>
        <Meter
          title="Model readiness"
          headline={readiness.headline}
          segments={readiness.segments}
          caption="Is the Genome complete and consistent? It does not say the app works or that the Purpose is served."
          asOf={`as of ${rev}, computed ${relativeTime(report.computedAt)}`}
          onActivate={onMeter}
        />
        <Meter
          title="Implementation conformance"
          headline={conformance.headline}
          segments={conformance.segments}
          caption="Do realizations satisfy Thing criteria? It does not say the Genome is ready or that users benefit."
          asOf={
            latest
              ? `as of ${rev}, latest evaluation ${relativeTime(latest)}`
              : `as of ${rev}, no evaluations in scope`
          }
          onActivate={onMeter}
        />
        <Meter
          title="Outcome progress"
          headline={outcome.headline}
          segments={outcome.segments}
          caption="Is the Purpose being achieved for people? Only observations of Theory claims move it, not tests or readiness."
          asOf={outcome.headline === "unknown" ? "no observations recorded" : `as of ${rev}`}
          onActivate={onMeter}
        />
      </div>
    </section>
  );
}
