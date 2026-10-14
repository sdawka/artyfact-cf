import { Handle, Position, type NodeProps } from "@xyflow/react";
import { kindColour, titleOf, useKindView } from "@/model/kinds";
import { useModel } from "@/model/useModel";
import { CandidateHalo } from "../overlays/CandidateHalo";
import { LayerBadges, useRealizationCount } from "./NodeOverlays";
import styles from "./nodes.module.css";
import type { SubjectFlowNode } from "./types";

/** A System node: a child of the scope or an outside node it links to. */
export function SubjectNode({ data, selected }: NodeProps<SubjectFlowNode>) {
  const { node, layer, candidates, dim, onOpen } = data;
  const info = useKindView(node.kind);
  const entry = useModel().byId(node.id);
  const name = entry ? titleOf(entry, info) : node.name;
  const realizations = useRealizationCount(node.id, layer);
  return (
    <div
      className={styles.node}
      data-map-node={node.id}
      data-role={node.role}
      data-system={node.kind === "system" || undefined}
      data-candidate-overlap={candidates.length > 1 || undefined}
      data-dim={dim || undefined}
      data-ring={(layer === "proteome" && realizations > 0) || undefined}
      data-selected={selected || undefined}
      data-status={data.status}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <div className={styles.title}>
        <span className={styles.glyph} style={kindColour(info)} aria-hidden="true">{info.glyph}</span>
        <span className={styles.name}>{name}</span>
      </div>
      <div className={styles.meta}>
        <span className={styles.kind}>{node.kind === "system" ? "System" : node.role === "outside" ? `${info.label} · outside this scope` : info.label}</span>
        {node.childCount > 0 && (
          <button
            type="button"
            className={`nodrag nopan ${styles.open}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(node.id, e.detail === 0); // detail 0: activated from the keyboard
            }}
            aria-label={`Open ${node.name} (${node.childCount} inside)`}
          >
            Enter · {node.childCount} inside
          </button>
        )}
      </div>
      {node.description && <p className={styles.purpose}>{node.description}</p>}
      {!!node.preview.length && <ul className={styles.preview} aria-label="Inside preview">{node.preview.map((child) => <li key={child.id}>{child.name}</li>)}</ul>}
      <div className={styles.badges}>
        <LayerBadges id={node.id} layer={layer} realizations={realizations} />
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
      <CandidateHalo candidates={candidates} />
    </div>
  );
}
