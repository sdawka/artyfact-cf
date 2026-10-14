import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "@/testing/render";

vi.mock("@/model/useReviewCount", () => ({ useReviewCount: () => 2 }));

describe("SideNav Review count", () => {
  it("shows the waiting count after Review, named for screen readers", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const review = within(nav).getByRole("link", { name: "Review, 2 waiting" });
    expect(review.textContent).toBe("◧Review2");
    expect(review.querySelector("[data-tone='attention']")?.textContent).toBe("2");
  });
});

describe("SideNav Work count", () => {
  it("shows plan work waiting from the System's live planCounts", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).endsWith("/api/systems")) return Response.json([]);
      if (String(url).endsWith("/api/systems/system.peopling")) return Response.json({ systemId: "system.peopling", planCounts: { open: 2, awaitingAgent: 2, submitted: 1, integrated: 0 } });
      return Promise.reject(new Error("offline in tests"));
    }));
    renderApp("/s/system.peopling/r/head/overview");
    const nav = await screen.findByRole("navigation", { name: "Views" });
    const work = await within(nav).findByRole("link", { name: "Work, 3 waiting" });
    expect(work.textContent).toMatch(/Work3$/);
    await waitFor(() => expect(urls).toContain("/api/systems/system.peopling"));
  });

  it("shows no count on fixture data", async () => {
    renderApp("/s/system.peopling/r/head/overview");
    const nav = await screen.findByRole("navigation", { name: "Views" });
    expect(within(nav).getByRole("link", { name: "Work" })).toBeTruthy();
  });
});
