import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "@/testing/render";

vi.mock("@/model/useReviewCount", () => ({ useReviewCount: () => 2 }));

describe("SideNav Review count", () => {
  it("uses consistent SVG navigation icons beside every visible label", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const nav = await screen.findByRole("navigation", { name: "Views" });
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.querySelector("svg")).not.toBeNull();
    }
  });

  it("shows the waiting count after Review, named for screen readers", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const review = within(nav).getByRole("link", { name: "Review, 2 waiting" });
    expect(review.textContent).toBe("Review2");
    expect(review.querySelector("[data-tone='attention']")?.textContent).toBe("2");
  });
});
