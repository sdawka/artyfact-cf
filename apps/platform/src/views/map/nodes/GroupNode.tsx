import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Link } from "react-router";
import { useKeepParams } from "@/model/useSelection";
import { useKindView } from "@/model/kinds";
import { CandidateHalo } from "../overlays/CandidateHalo";
import { LayerBadges, useRealizationCount } from "./NodeOverlays";
import { relationBorderStyle } from "../atlasRelationStyle";
import { KindTab } from "./TileParts";
import styles from "./nodes.module.css";
import type { GroupFlowNode } from "./types";

/** The scope: a quiet frame its children are nested in (containment is nesting, not edges). */
export function GroupNode({ data, selected }: NodeProps<GroupFlowNode>) {
  const { node, layer, candidates, dim } = data;
  const info = useKindView(node.kind);
  const name = node.name;
  const realizations = useRealizationCount(node.id, layer);
  const href = useKeepParams();
  return (
    <div
      className={styles.group}
      style={relationBorderStyle(data.relation)}
      data-related={!!data.relation || undefined}
      data-emphasized={data.emphasized || undefined}
      data-map-node={node.id}
      data-role="scope"
      data-kind={node.kind}
      data-system={node.kind === "system" || undefined}
      data-dim={dim || undefined}
      data-ring={(layer === "proteome" && realizations > 0) || undefined}
      data-selected={selected || undefined}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <div className={styles.groupHead}>
        <KindTab view={info} label={node.kind === "system" ? "System" : info.label} />
        <div className={styles.groupTitle}>
          <span className={styles.groupName} title={name}>{name}</span>
          <span className={styles.groupBadges}><LayerBadges id={node.id} layer={layer} realizations={realizations} /></span>
        </div>
      </div>
      {node.childCount === 0 && <p className={styles.empty}>
        Nothing inside {name} yet. <Link className="nodrag nopan" to={href("work", { panel: "intent", anchor: node.id })}>Describe a change</Link> to add parts.
      </p>}
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
      <CandidateHalo candidates={candidates} />
    </div>
  );
}
