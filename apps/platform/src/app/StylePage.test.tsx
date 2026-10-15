import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";

describe("/style", () => {
  it("shows a labelled sample of every primitive and state, effects last", async () => {
    renderApp("/style");
    await screen.findByRole("heading", { level: 1, name: "Style sheet" });
    const ids = [...document.querySelectorAll("[data-style-sample]")].map((el) => el.getAttribute("data-style-sample"));
    for (const id of ["type--type-h1", "colour--color-attention", "colour--surface-overlay", "link", "button-reason", "button-pressed", "form", "facts",
      "command-block", "page-header-standard", "page-header-system", "page-header-compact", "section", "panel", "card", "row-list", "list-detail",
      "steps", "status-text", "count", "kbd", "verdict-row", "empty", "error", "loading", "focus", "effects"]) {
      expect(ids, id).toContain(id);
    }
    expect(ids.at(-1)).toBe("effects");
    const h2s = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2s.at(-1)).toBe("Signature effects");
    expect(screen.getByRole("button", { name: "Create System" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Could not load builds.");
  });
});
