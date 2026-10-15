import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, useStore, type EdgeProps } from "@xyflow/react";
import type { ElkPoint } from "@/graph/elk";
import type { CrossLinkFlowEdge } from "../nodes/types";
import { useEffectsPreference } from "@/effects/effectsPreference";
import styles from "./CrossLinkEdge.module.css";

const DASH: Record<string, string | undefined> = { solid: undefined, dashed: "6 4", dotted: "1.5 4" };

/** Where the label chip of an elk route goes: the middle of its longest segment. */
export function labelAnchor(points: readonly ElkPoint[]): [number, number] {
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
  return mid;
}

/** Path through elk's orthogonal route, with the label anchor. */
function routePath(points: ElkPoint[]): [string, number, number] {
  const d = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  return [d, ...labelAnchor(points)];
}

/** A cross-link. Style carries certainty (solid declared, dashed assumed, dotted proposed); colour does not. */
export function CrossLinkEdge(props: EdgeProps<CrossLinkFlowEdge>) {
  const { id, data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd } = props;
  const edge = data!.edge;
  const { enabled: effects } = useEffectsPreference();
  const view = useStore((s) => ({ tx: s.transform[0], ty: s.transform[1], zoom: s.transform[2], w: s.width, h: s.height }), (a, b) => a.tx === b.tx && a.ty === b.ty && a.zoom === b.zoom && a.w === b.w && a.h === b.h);
  const onScreen = (x: number, y: number) => { const sx = x * view.zoom + view.tx, sy = y * view.zoom + view.ty; return sx >= 0 && sy >= 0 && sx <= view.w && sy <= view.h; };
  const measured = view.w > 0 && view.h > 0;
  // An Outside end beyond the pan area ends the line as a short stub (the Outside menu reaches that node).
  const away = !measured || !data?.outsideEnd ? undefined : data.outsideEnd === "source" ? !onScreen(sourceX, sourceY) : !onScreen(targetX, targetY);
  const stub = !!away;
  const sourceIn = data?.outsideEnd !== "source", targetIn = data?.outsideEnd !== "target";
  const [path, fullX, fullY] =
    data?.points && data.points.length > 1
      ? routePath(data.points)
      : getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 4 });
  const [from, to] = sourceIn ? [{ x: sourceX, y: sourceY }, { x: targetX, y: targetY }] : [{ x: targetX, y: targetY }, { x: sourceX, y: sourceY }];
  const run = Math.hypot(to.x - from.x, to.y - from.y) || 1, reach = Math.min(run, 64 / view.zoom);
  const stubPath = `M${from.x},${from.y} L${from.x + (to.x - from.x) * reach / run},${from.y + (to.y - from.y) * reach / run}`;
  const labelX = stub ? (from.x + (from.x + (to.x - from.x) * reach / run)) / 2 : fullX, labelY = stub ? (from.y + (from.y + (to.y - from.y) * reach / run)) / 2 : fullY;
  const text = `${edge.type}${edge.count > 1 ? ` ×${edge.count}` : ""}`;
  return (
    <>
      <BaseEdge
        id={id}
        path={stub ? stubPath : path}
        {...(markerEnd && !stub && { markerEnd })}
        className={`${styles.path} ${data?.active ? styles.active : ""}`}
        style={{ strokeDasharray: DASH[edge.stroke], opacity: data?.dim ? 0.15 : 1, strokeWidth: data?.active ? "var(--graph-edge-width-active)" : "var(--graph-edge-width)" }}
      />
      {data?.flow && effects && !stub && <path d={path} className={`fx-flow ${styles.flow}`} aria-hidden="true" data-edge-flow={id} />}
      {data?.showLabel !== false && (
      <EdgeLabelRenderer>
        <span
          className={`nodrag nopan ${styles.label}`}
          data-active={data?.active || undefined}
          data-dim={data?.dim || undefined}
          data-edge-type={edge.type}
          data-certainty={edge.certainty}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={`${edge.label ? `${edge.label}: ` : ""}${edge.type}, ${edge.certainty}${edge.count > 1 ? `, ${edge.count} links` : ""}`}
        >
          {text}
        </span>
      </EdgeLabelRenderer>
      )}
    </>
  );
}
