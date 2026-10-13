import { ActiveEvolutionsCard } from "./ActiveEvolutionsCard";
import { AppTemplateCard } from "./AppTemplateCard";
import { BlockersList } from "./BlockersList";
import { DeployCard } from "./DeployCard";
import { PhaseCard } from "./PhaseCard";
import { PurposeCard } from "./PurposeCard";
import { SystemHero } from "./SystemHero";
import styles from "./Overview.module.css";

/** Landing view: the System hero (card light, name, Purpose, three separate states), Purpose detail, active Evolutions, blockers with why, deployment and the app template. */
export default function OverviewView() {
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 id="view-title">Overview</h1>
      </header>
      <SystemHero />
      <PurposeCard leadShown />
      <div className={styles.twoCol}>
        <ActiveEvolutionsCard />
        <BlockersList />
      </div>
      <div className={styles.twoCol}>
        <PhaseCard />
        <DeployCard />
      </div>
      <AppTemplateCard />
    </div>
  );
}
