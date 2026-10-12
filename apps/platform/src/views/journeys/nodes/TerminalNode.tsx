import type { NodeProps } from "@xyflow/react";
import type { StepNode } from "../useJourneyGraph";
import { NodeShell } from "./NodeShell";

export function TerminalNode({ data }: NodeProps<StepNode>) {
  return <NodeShell type="terminal" data={data} />;
}
