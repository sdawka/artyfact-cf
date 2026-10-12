import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useModel } from "@/model/useModel";
import { GapsSummary } from "./GapsSummary";
import { LogicModel } from "./LogicModel";
import styles from "./TheoryView.module.css";

export default function TheoryView() {
  const { purposes, claims } = useModel().bundle.model;
  return (
    <section className={styles.view} aria-labelledby="view-title">
      <header>
        <h1 id="view-title">Theory</h1>
        <p className={styles.banner} role="note">
          Hypotheses, not a validated causal model
        </p>
      </header>
      <GapsSummary />
      {claims.length === 0 ? (
        <EmptyState title="This system states no theory claims." />
      ) : (
        <div className={styles.scroll} tabIndex={0} role="region" aria-label="Logic model, scrolls horizontally">
          <LogicModel purposes={purposes} claims={claims} />
        </div>
      )}
    </section>
  );
}
