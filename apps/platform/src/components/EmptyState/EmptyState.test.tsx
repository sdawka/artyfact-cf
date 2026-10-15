import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/testing/render";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("empty: a statement plus one action, no alert", () => {
    render(<EmptyState title="No builds yet." action={<button>Open Review</button>}>A build starts when a candidate is promoted.</EmptyState>);
    expect(screen.getByText("No builds yet.").tagName).toBe("P");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Open Review" })).toBeTruthy();
  });
  it("error: role=alert, cause, and Try again from onRetry", () => {
    const retry = vi.fn();
    render(<EmptyState kind="error" title="Could not load builds." onRetry={retry} headingLevel={3}>The API returned 503.</EmptyState>);
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-kind")).toBe("error");
    expect(screen.getByRole("heading", { level: 3, name: "Could not load builds." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
});
