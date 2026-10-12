import { ActiveEvolutionsCard } from "./ActiveEvolutionsCard";
import { BlockersList } from "./BlockersList";
import { DeployCard } from "./DeployCard";
import { PhaseCard } from "./PhaseCard";
import { PurposeCard } from "./PurposeCard";
import { ThreeStatesRow } from "./ThreeStatesRow";
import { useModel } from "@/model/useModel";
import styles from "./Overview.module.css";

/** Landing view: the Purpose, three separate states, active Evolutions, and blockers with why. */
export default function OverviewView() {
  const m = useModel();
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 id="view-title">Overview</h1>
        <p className={styles.muted}>{m.index.model.system.name}</p>
      </header>
      <PurposeCard />
      <ThreeStatesRow />
      <div className={styles.twoCol}>
        <ActiveEvolutionsCard />
        <BlockersList />
      </div>
      <div className={styles.twoCol}>
        <PhaseCard />
        <DeployCard />
      </div>
    </div>
  );
}
