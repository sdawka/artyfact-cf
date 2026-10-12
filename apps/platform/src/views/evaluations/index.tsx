import { useSearchParams } from "react-router";
import { useEvaluationFx } from "@/effects/fx";
import { useModel } from "@/model/useModel";
import { EvaluationsTable } from "./EvaluationsTable";
import styles from "./evaluations.module.css";

/** Evidence table for every loaded Evaluation. Verdicts here are per evaluation, labelled by candidate. */
export default function EvaluationsView() {
  const m = useModel();
  const [params, setParams] = useSearchParams();
  useEvaluationFx(m.evaluations);
  const expand = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("evaluation", id);
      else next.delete("evaluation");
      return next;
    }, { replace: true });
  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <h1 id="view-title">Evaluations</h1>
      <p className={styles.lede}>
        Evidence per criterion and candidate. A row says what was asked, how it was checked and what was observed. Nothing here is a verdict on the canonical System unless that candidate was promoted.
      </p>
      <EvaluationsTable evaluations={m.evaluations} expandedId={params.get("evaluation")} onExpand={expand} />
    </section>
  );
}
