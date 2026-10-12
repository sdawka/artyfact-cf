import type { NodeProps } from "@xyflow/react";
import type { StepNode } from "../useJourneyGraph";
import { NodeShell } from "./NodeShell";

export function SystemNode({ data }: NodeProps<StepNode>) {
  return <NodeShell type="system" data={data} />;
}
