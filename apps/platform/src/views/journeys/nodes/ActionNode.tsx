import type { NodeProps } from "@xyflow/react";
import type { StepNode } from "../useJourneyGraph";
import { NodeShell } from "./NodeShell";

export function ActionNode({ data }: NodeProps<StepNode>) {
  return <NodeShell type="action" data={data} />;
}
