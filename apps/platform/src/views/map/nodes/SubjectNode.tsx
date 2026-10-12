import { Handle, Position, type NodeProps } from "@xyflow/react";
import { kindInfo } from "@/model/kinds";
import { CandidateHalo } from "../overlays/CandidateHalo";
import { LayerBadges, useRealizationCount } from "./NodeOverlays";
import styles from "./nodes.module.css";
import type { SubjectFlowNode } from "./types";

/** A System node: a child of the scope or an outside node it links to. */
export function SubjectNode({ data, selected }: NodeProps<SubjectFlowNode>) {
  const { node, layer, candidates, dim, onOpen } = data;
  const info = kindInfo(node.kind);
  const realizations = useRealizationCount(node.id, layer);
  return (
    <div
      className={styles.node}
      data-map-node={node.id}
      data-role={node.role}
      data-dim={dim || undefined}
      data-ring={(layer === "proteome" && realizations > 0) || undefined}
      data-selected={selected || undefined}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <div className={styles.title}>
        <span className={styles.glyph} aria-hidden="true">{info.glyph}</span>
        <span className={styles.name}>{node.name}</span>
      </div>
      <div className={styles.meta}>
        <span className={styles.kind}>{node.role === "outside" ? `${info.label} · outside` : info.label}</span>
        {node.childCount > 0 && (
          <button
            type="button"
            className={`nodrag nopan u-brackets ${styles.open}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(node.id);
            }}
            aria-label={`Open ${node.name} (${node.childCount} inside)`}
          >
            {node.childCount} inside ›
          </button>
        )}
      </div>
      <div className={styles.badges}>
        <LayerBadges id={node.id} layer={layer} realizations={realizations} />
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
      <CandidateHalo candidates={candidates} />
    </div>
  );
}
