import type { NodeProps } from "@xyflow/react";
import styles from "./nodes.module.css";
import type { BoundaryFlowNode } from "./types";

/** The System boundary: Externals to its left, the System to its right. Not interactive. */
export function BoundaryNode({ data }: NodeProps<BoundaryFlowNode>) {
  return (
    <div className={styles.boundary} style={{ height: data.height }} aria-hidden="true">
      <span className={styles.boundaryLabel}>System boundary</span>
    </div>
  );
}
