import { SmoothStepEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { StepEdge } from "./useJourneyGraph";

/** The built-in smooth-step edge, plus a travelling dash of light when it touches the selected step. */
export function FlowStepEdge(props: EdgeProps<StepEdge>) {
  const { id, data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const [path] = data?.flow ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) : [""];
  return (
    <>
      <SmoothStepEdge {...props} />
      {data?.flow && <path d={path} className="fx-flow" aria-hidden="true" data-edge-flow={id} />}
    </>
  );
}
