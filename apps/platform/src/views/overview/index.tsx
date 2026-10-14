import { Link } from "react-router";
import { PageHeader } from "@/components/PageHeader/PageHeader";
import { Button } from "@/components/ui";
import { useModel } from "@/model/useModel";
import { useKeepParams } from "@/model/useSelection";
import { ActiveEvolutionsCard } from "./ActiveEvolutionsCard";
import { BlockersList } from "./BlockersList";
import { FactsStrip } from "./FactsStrip";
import { NeedsYou } from "./NeedsYou";
import { PurposeInFull } from "./PurposeInFull";
import { SystemHero } from "./SystemHero";
import { ThreeStatesRow } from "./ThreeStatesRow";
import styles from "./Overview.module.css";

/** Landing view: is this System ready, and what waits on me? Header, the System's light, Needs you, three readings, work, facts. */
export default function OverviewView() {
  const m = useModel();
  const href = useKeepParams();
  const system = m.index.model.system;
  const purpose = [...m.index.model.purposes].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }))[0];
  return (
    <div className={styles.view}>
      <PageHeader
        variant="system"
        title={system.name}
        purpose={
          purpose ? <>{purpose.statement} <span className={styles.purposeId}>{purpose.id}</span></> : "This System declares no Purpose."
        }
        primary={<Button asChild variant="primary"><Link to={href("work", { panel: "intent" })}>Describe a change</Link></Button>}
      />
      <SystemHero />
      <NeedsYou />
      <ThreeStatesRow />
      <div className={styles.twoCol}>
        <ActiveEvolutionsCard />
        <BlockersList />
      </div>
      <FactsStrip />
      <PurposeInFull />
    </div>
  );
}
