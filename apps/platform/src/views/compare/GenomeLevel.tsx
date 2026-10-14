import type { GenomeCompare } from "../../../shared/api";
import { SemanticDelta } from "@/views/work/panels/amendment/SemanticDelta";
import { useSemanticDelta } from "./genomeDelta";
import styles from "./compare.module.css";

/** The semantic Genome delta between the two revisions, summary first, with field before/after. */
export function GenomeLevel({ cmp, from, to }: { cmp: GenomeCompare; from: string; to: string }) {
  const delta = useSemanticDelta(cmp.delta, from, to);
  if (!delta) {
    return <p className={styles.muted}>{cmp.loadError ? `Genome comparison unknown: ${cmp.loadError}` : "No Genome comparison."}</p>;
  }
  return <SemanticDelta delta={delta} summary />;
}
