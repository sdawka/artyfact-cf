import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useEvaluationFx } from "@/effects/fx";
import { useModel } from "@/model/useModel";
import { EvolutionBoard } from "./EvolutionBoard";
import { EvolutionDetail } from "./EvolutionDetail";
import { IntentPanel } from "./intent/IntentPanel";
import { NewEvolutionPanel } from "./panels/NewEvolutionPanel";
import { useWorkData } from "./data";
import { useParam } from "./lib";
import styles from "./work.module.css";

/** Evolution board plus the detail pane for `?evolution=`; `?panel=new` opens a form above the board; `?panel=intent` replaces the board and detail. */
export default function WorkView() {
  const { evolutions, realizations } = useWorkData();
  useEvaluationFx(useModel().evaluations);
  const [evolutionId, setEvolutionId] = useParam("evolution");
  const [realizationId] = useParam("realization");
  const [panel, setPanel] = useParam("panel");
  const creating = panel === "new";
  const describing = panel === "intent";
  const closePanel = () => setPanel(null, { anchor: null, proposal: null });
  // A deep link to a realization opens its Evolution even without ?evolution=.
  const effectiveId = evolutionId ?? realizations.find((r) => r.id === realizationId)?.evolution ?? null;
  const selected = evolutions.find((e) => e.id === effectiveId);
  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <div className={styles.detailHead}>
        <h1 id="view-title">Work</h1>
        <span className={styles.inlineRow}>
          <button
            type="button"
            // The page's one primary action while nothing else (a panel, a selected Evolution) offers one.
            className={`u-brackets ${panel || selected ? styles.btn : styles.primary}`}
            aria-pressed={describing}
            onClick={() => (describing ? closePanel() : setPanel("intent", { evolution: null, realization: null }))}
          >
            Describe a change
          </button>
          <button
            type="button"
            className={styles.textBtn}
            aria-pressed={creating}
            onClick={() => (creating ? setPanel(null) : setPanel("new", { evolution: null, realization: null, anchor: null, proposal: null }))}
          >
            + Evolution
          </button>
        </span>
      </div>
      {creating && (
        <NewEvolutionPanel onCreated={(e) => setEvolutionId(e.id, { panel: null })} onCancel={() => setPanel(null)} />
      )}
      {describing && (
        <IntentPanel
          onClose={closePanel}
          // The accepted ops are a Genome realization with a candidate: open it on the board.
          onAccepted={(res) => setEvolutionId(res.evolution.id, { realization: res.realization.id, panel: null, anchor: null, proposal: null })}
        />
      )}
      {describing ? null : evolutions.length === 0 ? (
        <EmptyState surface title="No Evolutions yet — nothing is waiting to be built." />
      ) : (
        <EvolutionBoard
          evolutions={evolutions}
          selectedId={selected?.id ?? null}
          onSelect={(id) => setEvolutionId(id === evolutionId ? null : id, { panel: null, realization: null })}
        />
      )}
      {describing ? null : selected ? (
        <EvolutionDetail evolution={selected} realizations={realizations} />
      ) : evolutions.length > 0 ? (
        <p className={styles.muted}>Select an Evolution to see its realizations, start work or promote.</p>
      ) : null}
    </section>
  );
}
