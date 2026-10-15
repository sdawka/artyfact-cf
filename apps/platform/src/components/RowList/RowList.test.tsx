import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import "@/testing/render";
import { Row, RowList } from "./RowList";

describe("RowList and Row", () => {
  it("whole row is one link with title, meta and status; trailing stays outside; current sets aria-current", () => {
    render(<MemoryRouter><RowList label="Systems">
      <Row to="/s/p" title="Peopling" meta="2 await review" status="live" tone="attention" current trailing={<button>Review</button>} />
      <Row to="/s/a" title="Artyfact" />
    </RowList></MemoryRouter>);
    const list = screen.getByRole("list", { name: "Systems" });
    expect(list.getAttribute("data-density")).toBe("standard");
    const link = screen.getByRole("link", { name: /Peopling/ });
    expect(link.textContent).toBe("Peopling2 await reviewlive");
    expect(link.getAttribute("aria-current")).toBe("true");
    expect(link.className).toContain("u-selectable");
    expect(link.contains(screen.getByRole("button", { name: "Review" }))).toBe(false);
    expect(screen.getByRole("link", { name: "Artyfact" }).hasAttribute("aria-current")).toBe(false);
    expect(screen.getByText("live").getAttribute("data-tone")).toBe("attention");
  });

  it("button rows, and static compact rows", () => {
    const select = vi.fn();
    render(<RowList label="Events" density="compact"><Row title="a" onSelect={select} /><Row title="b" current /></RowList>);
    fireEvent.click(screen.getByRole("button", { name: "a" }));
    expect(select).toHaveBeenCalled();
    const items = screen.getAllByRole("listitem");
    expect(items[0]!.getAttribute("data-density")).toBe("compact");
    expect(items[1]!.querySelector(".u-selected")).toBeTruthy();
  });

  it("label names the target, targetProps reach it, and a disclosure row shows children only while expanded", () => {
    const { rerender } = render(<MemoryRouter><RowList label="Rows">
      <Row to="/s/p" title="Peopling" meta="2" label="Peopling, 2 await your review" targetProps={{ "data-testid": "row-p" }} />
      <Row title="Run" onSelect={() => {}} expanded={false} targetProps={{ "data-kind": "run" }}>details</Row>
    </RowList></MemoryRouter>);
    const link = screen.getByRole("link", { name: "Peopling, 2 await your review" });
    expect(link.getAttribute("data-testid")).toBe("row-p");
    const toggle = screen.getByRole("button", { name: "Run" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("data-kind")).toBe("run");
    expect(screen.queryByText("details")).toBeNull();
    rerender(<MemoryRouter><RowList label="Rows">
      <Row title="Run" onSelect={() => {}} expanded targetProps={{ "data-kind": "run" }}>details</Row>
    </RowList></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Run" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Run" }).contains(screen.getByText("details"))).toBe(false);
  });
});
