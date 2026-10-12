import { Handle, Position, type NodeProps } from "@xyflow/react";
import { kindInfo } from "@/model/kinds";
import { CandidateHalo } from "../overlays/CandidateHalo";
import { LayerBadges, useRealizationCount } from "./NodeOverlays";
import styles from "./nodes.module.css";
import type { GroupFlowNode } from "./types";

/** The scope: a frame its children are nested in (containment is nesting, not edges). */
export function GroupNode({ data, selected }: NodeProps<GroupFlowNode>) {
  const { node, layer, candidates, dim } = data;
  const info = kindInfo(node.kind);
  const realizations = useRealizationCount(node.id, layer);
  return (
    <div
      className={styles.group}
      data-map-node={node.id}
      data-role="scope"
      data-dim={dim || undefined}
      data-ring={(layer === "proteome" && realizations > 0) || undefined}
      data-selected={selected || undefined}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <div className={styles.groupHead}>
        <span className={styles.glyph} aria-hidden="true">{info.glyph}</span>
        <span className={styles.name}>{node.name}</span>
        <span className={styles.kind}>{info.label}</span>
        <span className={styles.groupBadges}>
          <LayerBadges id={node.id} layer={layer} realizations={realizations} />
        </span>
      </div>
      {node.childCount === 0 && <p className={styles.empty}>Nothing inside</p>}
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
      <CandidateHalo candidates={candidates} />
    </div>
  );
}
