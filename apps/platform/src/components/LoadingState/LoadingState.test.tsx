import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { EffectsProvider } from "@artyfact/effects";
import { LoadingState } from "./LoadingState";
import { EmptyState } from "../EmptyState/EmptyState";

afterEach(cleanup);
it("keeps loading text in a status frame and the decorative layer hidden", () => {
  const { container } = render(<EffectsProvider enabled={false}><LoadingState label="Loading model…" /></EffectsProvider>);
  const status = screen.getByRole("status");
  expect(screen.getByText("Loading model…").closest('[role="status"]')).toBe(status);
  expect(status.querySelector('[data-effect="surface"]')?.getAttribute("aria-hidden")).toBe("true");
  expect(status.querySelectorAll('[aria-hidden="true"] span').length).toBeGreaterThan(2);
  expect(container.querySelector('[data-effect="orb"]')).toBeNull();
});
it("keeps empty-state text, next action and live behavior above its card light", () => {
  const { container } = render(<EffectsProvider enabled={false}><EmptyState title="No Systems yet." surface live action={<button>Import a System</button>}><p>Start with a Genome.</p></EmptyState></EffectsProvider>);
  expect(screen.getByRole("status").textContent).toContain("No Systems yet.");
  expect(screen.getByRole("button", { name: "Import a System" })).toBeTruthy();
  expect(screen.getByText("Start with a Genome.")).toBeTruthy();
  expect(container.querySelector('[data-effect="surface"]')?.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector('[data-effect="orb"]')).toBeNull();
});
