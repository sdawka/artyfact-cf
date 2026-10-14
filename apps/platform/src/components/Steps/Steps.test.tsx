import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/testing/render";
import { Steps } from "./Steps";

describe("Steps", () => {
  it("numbers the sequence, expands only the current step, summarises done ones", () => {
    const edit = vi.fn();
    render(<Steps label="Start a System" steps={[
      { id: "name", title: "Name your System", state: "done", summary: "system.peopling created", onEdit: edit },
      { id: "preview", title: "Preview your ontology", state: "current" },
      { id: "review", title: "Review the import", state: "todo" },
    ]}><button>Preview import</button></Steps>);
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["done", "current", "todo"]);
    expect(items[1]!.getAttribute("aria-current")).toBe("step");
    expect(items[1]!.textContent).toContain("Preview import");
    expect(items[2]!.querySelector("button")).toBeNull();
    expect(screen.getByText("system.peopling created")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit Name your System" }));
    expect(edit).toHaveBeenCalled();
    expect(screen.getByRole("list", { name: "Start a System" })).toBeTruthy();
  });
});
