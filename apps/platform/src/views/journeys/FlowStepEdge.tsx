import { SmoothStepEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { useEffectsPreference } from "@/effects/effectsPreference";
import type { StepEdge } from "./useJourneyGraph";

/** The built-in smooth-step edge; edges touching the selected step get weight, and a quiet travelling dash only while Effects are on. */
export function FlowStepEdge(props: EdgeProps<StepEdge>) {
  const { enabled: effects } = useEffectsPreference();
  const { id, data, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const [path] = data?.flow && effects ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }) : [""];
  return (
    <>
      <SmoothStepEdge {...props} {...(data?.flow && { style: { ...props.style, stroke: failureAware(data), strokeWidth: 2 } })} />
      {data?.flow && effects && <path d={path} className="fx-flow journey-flow" aria-hidden="true" data-edge-flow={id} />}
    </>
  );
}

/** Selection is weight and ink; a failure edge keeps its danger colour and its dashes. */
const failureAware = (data: { failure: boolean }) => (data.failure ? "var(--graph-edge-danger)" : "var(--graph-edge-active)");
