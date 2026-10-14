import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import "@/testing/render";
import { PageHeader, ScopePath } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the h1 as the focus target, purpose, actions (secondary then primary) and status", () => {
    render(<PageHeader title="Review" purpose="Decisions waiting on you." secondary={<button>Compare</button>} primary={<button>Promote</button>} status={<span>2 waiting</span>} context={null} />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Review" });
    expect(h1.id).toBe("view-title");
    expect(h1.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByText("Decisions waiting on you.").tagName).toBe("P");
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["Compare", "Promote"]);
    expect(screen.getByText("2 waiting")).toBeTruthy();
    expect(h1.closest("header")!.getAttribute("data-variant")).toBe("standard");
  });

  it("compact: the purpose becomes the h1's accessible description", () => {
    render(<PageHeader variant="compact" title="Map" purpose="Where each part sits." context={<span>Env</span>} />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Map" });
    const desc = document.getElementById(h1.getAttribute("aria-describedby")!)!;
    expect(desc.textContent).toBe("Where each part sits.");
    expect(desc.className).toContain("sr-only");
    expect(h1.closest("header")!.getAttribute("data-variant")).toBe("compact");
  });

  it("system variant and custom title id", () => {
    render(<PageHeader variant="system" title="Peopling" titleId="sys" context={null} />);
    expect(screen.getByRole("heading", { level: 1 }).id).toBe("sys");
  });

  it("outside a System the route scope is empty, so no context renders", () => {
    render(<MemoryRouter><PageHeader title="Systems" /></MemoryRouter>);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("ScopePath", () => {
  it("links every step but the current one, which is plain text marked current", () => {
    render(<MemoryRouter><ScopePath crumbs={[{ label: "Peopling", to: "/s/p" }, { label: "Web app", to: "/s/p/t" }, { label: "Work" }]} /></MemoryRouter>);
    const nav = screen.getByRole("navigation", { name: "Scope" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Peopling", "Web app"]);
    expect(within(nav).getByText("Work").getAttribute("aria-current")).toBe("page");
    expect(nav.querySelector(".u-marker")).toBeNull();
  });
});
