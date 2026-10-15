import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useKindViews } from "@/model/kinds";
import type { External } from "@/model/types";
import { useModel } from "@/model/useModel";
import { relationBorderStyle } from "../atlasRelationStyle";
import { tileMetrics } from "../atlasTile";
import { KindTab, metricStyle } from "./TileParts";
import styles from "./nodes.module.css";
import type { ExternalFlowNode } from "./types";

/** An External outside the System boundary: a dashed tile in a perimeter column, kind tab and name, no layer lane. */
export function ExternalNode({ data, selected }: NodeProps<ExternalFlowNode>) {
  const { node, dim } = data;
  const views = useKindViews();
  const info = views.of(node.kind);
  const ext = useModel().byId(node.id)?.item as External | undefined;
  const metrics = data.metrics ?? tileMetrics(node, views);
  return (
    <div className={`${styles.node} ${styles.external}`} style={{ ...relationBorderStyle(data.relation), ...metricStyle(metrics) }} data-related={!!data.relation || undefined} data-emphasized={data.emphasized || undefined} data-map-node={node.id} data-role="external" data-kind={node.kind} data-dim={dim || undefined} data-selected={selected || undefined} data-status={data.status}>
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <KindTab view={info} label={`${info.label}${ext?.kind ? ` ${ext.kind}` : ""}`} />
      <div className={styles.body}>
        <div className={styles.name} data-faded={metrics.titleFaded || undefined}>{node.name}</div>
        {metrics.purpose.text && <p className={styles.purpose} data-faded={metrics.purpose.faded || undefined}>{metrics.purpose.text}</p>}
      </div>
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
    </div>
  );
}
