import type { NodeProps } from "@xyflow/react";
import type { StepNode } from "../useJourneyGraph";
import { NodeShell } from "./NodeShell";

export function DecisionNode({ data }: NodeProps<StepNode>) {
  return <NodeShell type="decision" data={data} />;
}
