import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Link } from "react-router";
import { useKeepParams } from "@/model/useSelection";
import { kindColour, titleOf, useKindView } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { CandidateHalo } from "../overlays/CandidateHalo";
import { LayerBadges, useRealizationCount } from "./NodeOverlays";
import { relationBorderStyle } from "../atlasRelationStyle";
import styles from "./nodes.module.css";
import type { GroupFlowNode } from "./types";

/** The scope: a frame its children are nested in (containment is nesting, not edges). */
export function GroupNode({ data, selected }: NodeProps<GroupFlowNode>) {
  const { node, layer, candidates, dim } = data;
  const info = useKindView(node.kind);
  const entry = useModel().byId(node.id);
  const name = entry ? titleOf(entry, info) : node.name;
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
      data-dim={dim || undefined}
      data-ring={(layer === "proteome" && realizations > 0) || undefined}
      data-selected={selected || undefined}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <div className={styles.groupHead}>
        <div className={styles.title}>
          <span className={styles.glyph} style={kindColour(info)} aria-hidden="true">{info.glyph}</span>
          <span className={styles.name}>{name}</span>
        </div>
        <div className={styles.meta}>
          <span className={styles.kind}>{info.label}, current scope</span>
          <LayerBadges id={node.id} layer={layer} realizations={realizations} />
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
