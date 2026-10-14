import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/testing/render";
import { Section } from "./Section";

describe("Section", () => {
  it("is a region named by its heading, with count, description and actions", () => {
    render(<Section title="Builds" count={0} description="Newest first." actions={<button>Refresh</button>}>rows</Section>);
    const region = screen.getByRole("region", { name: /Builds/ });
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Builds 0");
    expect(region.getAttribute("data-surface")).toBe("none");
    expect(screen.getByText("Newest first.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });
  it("h3 and panel surface", () => {
    render(<Section title="Group" headingLevel={3} surface="panel" />);
    expect(screen.getByRole("heading", { level: 3, name: "Group" })).toBeTruthy();
    expect(screen.getByRole("region").getAttribute("data-surface")).toBe("panel");
  });
});
