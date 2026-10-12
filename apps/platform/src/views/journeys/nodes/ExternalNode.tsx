import type { NodeProps } from "@xyflow/react";
import type { StepNode } from "../useJourneyGraph";
import { NodeShell } from "./NodeShell";

export function ExternalNode({ data }: NodeProps<StepNode>) {
  return <NodeShell type="external" data={data} />;
}
