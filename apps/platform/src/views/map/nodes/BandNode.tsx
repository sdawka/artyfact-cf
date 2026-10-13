import type { NodeProps } from "@xyflow/react";
import styles from "./nodes.module.css";
import type { BandFlowNode } from "./types";

/** One template layer inside the scope: a labelled frame around the children of that layer. Not interactive. */
export function BandNode({ data }: NodeProps<BandFlowNode>) {
  return (
    <div className={styles.band} data-map-band={data.band.id}>
      <span className={styles.bandLabel}>{data.band.label}</span>
    </div>
  );
}
