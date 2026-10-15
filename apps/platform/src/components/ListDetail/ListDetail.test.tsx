import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/testing/render";
import { ListDetail } from "./ListDetail";

describe("ListDetail", () => {
  it("labels both panes and marks the selection for the one-pane layout", () => {
    const back = vi.fn();
    const { container } = render(<ListDetail list={<p>queue</p>} detail={<p>detail</p>} listLabel="Review queue" detailLabel="Decision" hasSelection onBack={back} backLabel="Back to queue" listWidth="wide" />);
    expect(screen.getByRole("region", { name: "Review queue" }).textContent).toBe("queue");
    expect(screen.getByRole("region", { name: "Decision" }).textContent).toContain("detail");
    const root = container.firstElementChild!;
    expect(root.hasAttribute("data-selection")).toBe(true);
    expect(root.getAttribute("data-list-width")).toBe("wide");
    fireEvent.click(screen.getByRole("button", { name: "Back to queue" }));
    expect(back).toHaveBeenCalled();
  });
  it("no back link without a selection", () => {
    const { container } = render(<ListDetail list="l" detail="d" listLabel="List" hasSelection={false} onBack={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.firstElementChild!.hasAttribute("data-selection")).toBe(false);
  });
});
