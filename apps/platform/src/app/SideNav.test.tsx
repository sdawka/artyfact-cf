import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "@/testing/render";

vi.mock("@/model/useReviewCount", () => ({ useReviewCount: () => 2 }));
vi.mock("@/model/useWorkCount", () => ({ useWorkCount: () => 3 }));

describe("SideNav Review count", () => {
  it("shows the waiting count after Review, named for screen readers", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const review = within(nav).getByRole("link", { name: "Review, 2 waiting" });
    expect(review.textContent).toBe("◧Review2");
    expect(review.querySelector("[data-tone='attention']")?.textContent).toBe("2");
  });

  it("shows the waiting count after Work", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const work = within(nav).getByRole("link", { name: "Work, 3 waiting" });
    expect(work.textContent).toBe("⎇Work3");
  });
});
