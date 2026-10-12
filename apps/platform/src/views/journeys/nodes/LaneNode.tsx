import type { Node, NodeProps } from "@xyflow/react";
import styles from "./NodeShell.module.css";

export type LaneNodeData = { label: string; lane: string; width: number; height: number } & Record<string, unknown>;
export type LaneBandNode = Node<LaneNodeData, "lane">;

/** Translucent swim-lane band behind the steps; not interactive. */
export function LaneNode({ data }: NodeProps<LaneBandNode>) {
  return (
    <div className={styles.lane} data-lane={data.lane} style={{ width: data.width, height: data.height }}>
      <span className={styles.laneLabel}>{data.label}</span>
    </div>
  );
}
