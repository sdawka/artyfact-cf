import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LineDiff } from "./LineDiff";

afterEach(cleanup);
const lines = (n: number) => Array.from({ length: n }, (_, i) => `l${i + 1}`).join("\n") + "\n";

describe("LineDiff", () => {
  it("renders add/del/ctx rows with sign cells and expands a collapser", () => {
    const before = lines(20);
    const { container } = render(<LineDiff from={before} to={before.replace("l10\n", "ten\n")} label="src/a.ts" />);
    const table = screen.getByRole("table", { name: "src/a.ts" });
    expect(table.querySelectorAll('[data-op="del"]')).toHaveLength(1);
    expect(table.querySelectorAll('[data-op="add"]')).toHaveLength(1);
    expect(table.querySelectorAll('[data-op="ctx"]')).toHaveLength(6);
    expect(screen.getByLabelText("removed").textContent).toBe("−");
    expect(screen.getByLabelText("added").textContent).toBe("+");
    fireEvent.click(screen.getByRole("button", { name: "… 6 unchanged lines" }));
    expect(table.querySelectorAll('[data-op="ctx"]')).toHaveLength(12);
    expect(container.querySelector('[data-tone="pass"]')).toBeNull();
  });

  it("shows every line as added when the old side is null, and as removed when the new side is null", () => {
    const { container, unmount } = render(<LineDiff from={null} to={"a\nb\n"} label="new" />);
    expect(container.querySelectorAll('[data-op="add"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-op="del"]')).toHaveLength(0);
    unmount();
    const r = render(<LineDiff from={"a\n"} to={null} label="gone" />);
    expect(r.container.querySelectorAll('[data-op="del"]')).toHaveLength(1);
  });
});
