import { Link, useSearchParams } from "react-router";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { useEvaluationFx } from "@/effects/fx";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { EvaluationsTable, type EvaluationFilters } from "./EvaluationsTable";
import styles from "./evaluations.module.css";

const FILTER_KEYS = ["candidate", "criterion", "verdict", "execution"] as const;

/**
 * Evidence for every loaded Evaluation. Verdicts here are per evaluation, labelled by candidate. The filters
 * (`?candidate=&criterion=&verdict=&execution=`) and the expanded row (`?evaluation=`) live in the URL.
 */
export default function EvaluationsView() {
  const m = useModel();
  const href = useKeepParams();
  const [params, setParams] = useSearchParams();
  useEvaluationFx(m.evaluations);
  const expand = (id: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (id) next.set("evaluation", id);
      else next.delete("evaluation");
      return next;
    }, { replace: true });
  const filters = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ""])) as unknown as EvaluationFilters;
  const setFilters = (f: EvaluationFilters) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const k of FILTER_KEYS) {
        if (f[k]) next.set(k, f[k]);
        else next.delete(k);
      }
      return next;
    }, { replace: true });
  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <PageHeader title="Evaluations" purpose="Evidence for each criterion, with method and limits.">
        <p className={styles.note}>Nothing here is a verdict on the canonical System unless that candidate was promoted.</p>
      </PageHeader>
      <EvaluationsTable
        evaluations={m.evaluations}
        expandedId={params.get("evaluation")}
        onExpand={expand}
        filters={filters}
        onFilters={setFilters}
        emptyAction={<Link className="u-marker" to={href("review")}>Open Review</Link>}
      />
    </section>
  );
}
