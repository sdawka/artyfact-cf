import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("renders a titled surface with actions and a state", () => {
    const { container } = render(<Card title="Builds" headingLevel={3} state="attention" actions={<button>Run</button>}>body</Card>);
    expect(screen.getByRole("heading", { level: 3, name: "Builds" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run" })).toBeTruthy();
    expect(container.firstElementChild!.tagName).toBe("SECTION");
    expect(container.firstElementChild!.getAttribute("data-state")).toBe("attention");
  });

  it("with `to`, the whole card is one link", () => {
    render(<MemoryRouter><Card as="article" to="/x" title="Alpha" state="unbuilt">details</Card></MemoryRouter>);
    const link = screen.getByRole("link", { name: /Alpha.*details/ });
    expect(link.getAttribute("href")).toBe("/x");
    expect(link.getAttribute("data-state")).toBe("unbuilt");
    expect(link.className).toContain("u-brackets");
    expect(link.closest("article")).toBeTruthy();
  });
});
