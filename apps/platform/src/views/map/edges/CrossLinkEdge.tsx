import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { ElkPoint } from "@/graph/elk";
import type { CrossLinkFlowEdge } from "../nodes/types";
import styles from "./CrossLinkEdge.module.css";

const DASH: Record<string, string | undefined> = { solid: undefined, dashed: "6 4", dotted: "1.5 4" };

/** Path through elk's orthogonal route and the label at the middle of its longest segment. */
function routePath(points: ElkPoint[]): [string, number, number] {
  const d = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  let best = 0;
  let mid: [number, number] = [points[0]!.x, points[0]!.y];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (len > best) {
      best = len;
      mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    }
  }
  return [d, mid[0], mid[1]];
}

/** A cross-link. Style carries certainty (solid declared, dashed assumed, dotted proposed); colour does not. */
export function CrossLinkEdge(props: EdgeProps<CrossLinkFlowEdge>) {
  const { id, data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd } = props;
  const edge = data!.edge;
  const [path, labelX, labelY] =
    data?.points && data.points.length > 1
      ? routePath(data.points)
      : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 4 });
  const text = `${edge.label ?? edge.type}${edge.count > 1 ? ` ×${edge.count}` : ""}`;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd && { markerEnd })}
        className={styles.path}
        style={{ strokeDasharray: DASH[edge.stroke], opacity: data?.dim ? 0.15 : 1, strokeWidth: data?.active ? 2 : 1.25 }}
      />
      <EdgeLabelRenderer>
        <span
          className={`nodrag nopan ${styles.label}`}
          data-active={data?.active || undefined}
          data-dim={data?.dim || undefined}
          data-edge-type={edge.type}
          data-certainty={edge.certainty}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={`${edge.type}, ${edge.certainty}${edge.count > 1 ? `, ${edge.count} links` : ""}`}
        >
          {text}
        </span>
      </EdgeLabelRenderer>
    </>
  );
}
