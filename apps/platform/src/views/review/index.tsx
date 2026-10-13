import { EmptyState } from "@/components/EmptyState/EmptyState";
import { useWorkData } from "../work/data";
import { useParam } from "../work/lib";
import { PromotionPanel } from "../work/panels/PromotionPanel";
import styles from "./review.module.css";

/**
 * The decisions that wait on a person. For now it hosts promotion (`?panel=promote&evolution=`, where old Work links
 * land); the queue of candidates, amendments and promotions comes with the Review slice.
 */
export default function ReviewView() {
  const { evolutions } = useWorkData();
  const [panel] = useParam("panel");
  const [evolutionId] = useParam("evolution");
  const promoting = panel === "promote" ? evolutions.find((e) => e.id === evolutionId) : undefined;
  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <h1 id="view-title">Review</h1>
      <p className={styles.lede}>Candidates, amendments and promotions that need a person.</p>
      {promoting ? <PromotionPanel evolution={promoting} /> : <EmptyState title="Nothing is waiting on you." />}
    </section>
  );
}
