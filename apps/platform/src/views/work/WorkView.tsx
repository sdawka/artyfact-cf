import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useEvaluationFx } from "@/effects/fx";
import { useModel } from "@/model/useModel";
import { EvolutionBoard } from "./EvolutionBoard";
import { EvolutionDetail } from "./EvolutionDetail";
import { useWorkData } from "./data";
import { useParam } from "./lib";
import styles from "./work.module.css";

/** Evolution board plus the detail pane for `?evolution=`. */
export default function WorkView() {
  const { evolutions, realizations } = useWorkData();
  useEvaluationFx(useModel().evaluations);
  const [evolutionId, setEvolutionId] = useParam("evolution");
  const [realizationId] = useParam("realization");
  // A deep link to a realization opens its Evolution even without ?evolution=.
  const effectiveId = evolutionId ?? realizations.find((r) => r.id === realizationId)?.evolution ?? null;
  const selected = evolutions.find((e) => e.id === effectiveId);
  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <h1 id="view-title">Work</h1>
      {evolutions.length === 0 ? (
        <EmptyState orb title="No Evolutions yet — nothing is waiting to be built." />
      ) : (
        <EvolutionBoard
          evolutions={evolutions}
          selectedId={selected?.id ?? null}
          onSelect={(id) => setEvolutionId(id === evolutionId ? null : id, { panel: null, realization: null })}
        />
      )}
      {selected ? (
        <EvolutionDetail evolution={selected} realizations={realizations} />
      ) : evolutions.length > 0 ? (
        <p className={styles.muted}>Select an Evolution to see its realizations, start work or promote.</p>
      ) : null}
    </section>
  );
}
