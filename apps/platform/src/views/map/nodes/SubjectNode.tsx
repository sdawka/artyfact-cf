import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useKindViews } from "@/model/kinds";
import { CandidateHalo } from "../overlays/CandidateHalo";
import { LayerBadges, useRealizationCount } from "./NodeOverlays";
import { relationBorderStyle } from "../atlasRelationStyle";
import { TILE, tileMetrics } from "../atlasTile";
import { InsideFooter, KindTab, metricStyle } from "./TileParts";
import styles from "./nodes.module.css";
import type { SubjectFlowNode } from "./types";

/** A System node: a child of the scope or an outside node it links to. Kind tab, name, purpose, what is inside, layer lane. */
export function SubjectNode({ data, selected }: NodeProps<SubjectFlowNode>) {
  const { node, layer, candidates, dim, onOpen } = data;
  const views = useKindViews();
  const info = views.of(node.kind);
  const name = node.name;
  const realizations = useRealizationCount(node.id, layer);
  const system = node.kind === "system";
  const metrics = data.metrics ?? tileMetrics(node, views, system ? TILE.systemWidth : TILE.width);
  return (
    <div
      className={styles.node}
      style={{ ...relationBorderStyle(data.relation), ...metricStyle(metrics) }}
      data-related={!!data.relation || undefined}
      data-emphasized={data.emphasized || undefined}
      data-map-node={node.id}
      data-role={node.role}
      data-kind={node.kind}
      data-system={system || undefined}
      data-candidate-overlap={candidates.length > 1 || undefined}
      data-dim={dim || undefined}
      data-ring={(layer === "proteome" && realizations > 0) || undefined}
      data-selected={selected || undefined}
      data-status={data.status}
    >
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <KindTab view={info} label={system ? "System" : info.label} />
      <div className={styles.body}>
        <div className={styles.name} data-faded={metrics.titleFaded || undefined}>{name}</div>
        {node.role === "outside" && <p className={styles.where}>Outside this scope</p>}
        {metrics.purpose.text && <p className={styles.purpose} data-faded={metrics.purpose.faded || undefined}>{metrics.purpose.text}</p>}
        {node.childCount > 0 && <InsideFooter node={node} onOpen={onOpen} />}
      </div>
      <div className={styles.lane}>
        <LayerBadges id={node.id} layer={layer} realizations={realizations} />
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
      <CandidateHalo candidates={candidates} />
    </div>
  );
}
