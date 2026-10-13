import { render } from "@testing-library/react";
import { Position, ReactFlowProvider, type EdgeProps } from "@xyflow/react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { certaintyStroke, type MapEdge } from "../useMapGraph";
import type { CrossLinkFlowEdge } from "../nodes/types";
import { CrossLinkEdge } from "./CrossLinkEdge";

afterEach(cleanup);

const edgeFor = (certainty: MapEdge["certainty"]): MapEdge => ({
  id: "a>reads>b",
  source: "a",
  target: "b",
  type: "reads",
  certainty,
  stroke: certaintyStroke(certainty),
  count: 1,
  members: [{ from: "a", to: "b", rel: "reads", certainty }],
});

function dashOf(certainty: MapEdge["certainty"], points = true) {
  const props = {
    id: "e",
    source: "a",
    target: "b",
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 40,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { edge: edgeFor(certainty), dim: false, active: false, ...(points && { points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }, { x: 100, y: 40 }] }) },
  } as unknown as EdgeProps<CrossLinkFlowEdge>;
  const { container } = render(
    <ReactFlowProvider>
      <svg>
        <CrossLinkEdge {...props} />
      </svg>
    </ReactFlowProvider>,
  );
  const path = container.querySelector("path.react-flow__edge-path") as SVGPathElement;
  return { dash: path.style.strokeDasharray, d: path.getAttribute("d") };
}

describe("CrossLinkEdge", () => {
  it("draws declared solid, assumed dashed and proposed dotted", () => {
    expect(dashOf("declared").dash).toBe("");
    expect(dashOf("assumed").dash).toBe("6 4");
    expect(dashOf("proposed").dash).toBe("1.5 4");
  });

  it("follows the elk route when given, else a smooth-step path", () => {
    expect(dashOf("declared").d).toBe("M0,0 L50,0 L50,40 L100,40");
    expect(dashOf("declared", false).d).toMatch(/^M/);
  });
});
