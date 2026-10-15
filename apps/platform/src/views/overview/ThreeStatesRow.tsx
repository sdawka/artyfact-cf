import { useReadiness } from "@/api/queries";
import { Meter } from "@/components/Meter/Meter";
import { Section } from "@/components/Section/Section";
import { emitFx } from "@/effects/fx";
import { useKeepParams } from "@/model/useSelection";
import { LAYER_QUESTIONS } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { conformanceMeter, outcomeMeter, readinessMeter, relativeTime, shortRev } from "./states";
import styles from "./Overview.module.css";

/** Three separate meters, each on its own scale and under its layer's question. They are never summed or averaged. */
export function ThreeStatesRow() {
  const m = useModel();
  const href = useKeepParams();
  const onMeter = (el: HTMLElement) => emitFx({ kind: "select" }, el);
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
    <Section title="Three states" description="Reported side by side. No combined score exists.">
      <div className={styles.meters}>
        <Meter
          title="Model readiness"
          to={href("map")}
          emptyText="No findings"
          question={LAYER_QUESTIONS.genome}
          headline={readiness.headline}
          segments={readiness.segments}
          caption="Is the Genome complete and consistent? It does not say the app works or that the Purpose is served."
          asOf={`as of ${rev}, computed ${relativeTime(report.computedAt)}`}
          onActivate={onMeter}
        />
        <Meter
          title="Implementation conformance"
          to={href("evaluations")}
          question={LAYER_QUESTIONS.proteome}
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
          to={href("phenome")}
          question={LAYER_QUESTIONS.phenome}
          headline={outcome.headline}
          segments={outcome.segments}
          caption="Is the Purpose being achieved for people? Only observations of Theory claims move it, not tests or readiness."
          asOf={outcome.headline === "unknown" ? "no observations recorded" : `as of ${rev}`}
          onActivate={onMeter}
        />
      </div>
    </Section>
  );
}
