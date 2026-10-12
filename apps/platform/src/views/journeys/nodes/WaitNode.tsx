import type { NodeProps } from "@xyflow/react";
import type { StepNode } from "../useJourneyGraph";
import { NodeShell } from "./NodeShell";

export function WaitNode({ data }: NodeProps<StepNode>) {
  return <NodeShell type="wait" data={data} />;
}
