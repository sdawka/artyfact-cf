import { Handle, Position, type NodeProps } from "@xyflow/react";
import { kindColour, useKindView } from "@/model/kinds";
import type { External } from "@/model/types";
import { useModel } from "@/model/useModel";
import styles from "./nodes.module.css";
import type { ExternalFlowNode } from "./types";

/** An External outside the System boundary (partition 0, left of the boundary). */
export function ExternalNode({ data, selected }: NodeProps<ExternalFlowNode>) {
  const { node, dim } = data;
  const info = useKindView(node.kind);
  const ext = useModel().byId(node.id)?.item as External | undefined;
  return (
    <div className={`${styles.node} ${styles.external}`} data-map-node={node.id} data-role="external" data-dim={dim || undefined} data-selected={selected || undefined} data-status={data.status}>
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <div className={styles.title}>
        <span className={styles.glyph} style={kindColour(info)} aria-hidden="true">{info.glyph}</span>
        <span className={styles.name}>{node.name}</span>
      </div>
      <div className={styles.meta}>
        <span className={styles.kind}>{info.label}{ext?.kind ? ` · ${ext.kind}` : ""}</span>
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
    </div>
  );
}
