import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "@/testing/render";
import { HomeContent } from "./index";
import type { CardSummary } from "./signifiers";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const base: CardSummary = {
  systemId: "system.a", title: "Alpha", head: "sc-2", genomeRepo: "g", appRepo: "a", genomeCommit: "g".repeat(40),
  phase: "realizing", evolutionCounts: {}, updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};
const evolving: CardSummary = {
  ...base,
  signifiers: ["evolving", "pending-realization", "not-fully-built"],
  realizationCounts: { evolving: 1, pending: 2, awaitingAdmin: 0 },
  latestBuild: { id: "b1", status: "running", kind: "production", commit: "c".repeat(40) },
  deployment: { production: null, previews: 0 },
  deployState: "none",
};
const awaiting: CardSummary = {
  ...base,
  systemId: "system.b", title: "Beta",
  signifiers: ["evolving", "awaiting-admin", "built", "deployed"],
  realizationCounts: { evolving: 1, pending: 0, awaitingAdmin: 1 },
  latestBuild: { id: "b2", status: "passed", kind: "production", commit: "d".repeat(40) },
  deployment: {
    production: { id: "d1", kind: "production", status: "live", repo: "app", commit: "d".repeat(40), by: "admin", createdAt: "", updatedAt: "" },
    previews: 1,
  },
  deployState: "live",
};

const stubSystems = (systems: CardSummary[]) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url) === "/api/systems" ? json(200, { systems }) : json(404, {}))));

const card = (name: RegExp) => screen.getByRole("link", { name }).closest("li")!;

describe("Home", () => {
  it("shows the fixture System in fixture mode and opens its Overview", async () => {
    const { router } = renderApp("/");
    const link = await screen.findByRole("link", { name: /Keep in Touch/ });
    expect(screen.getByText("fixture data")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry API" })).toBeTruthy();
    act(() => link.click());
    await waitFor(() => expect(router.state.location.pathname).toBe("/s/system.keep-in-touch/r/head/overview"));
  });

  it("shows the empty state with an init link when the API has no Systems", async () => {
    stubSystems([]);
    renderApp("/");
    expect(await screen.findByText("No Systems yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Import one with artyfact init" })).toBeTruthy();
    expect(screen.queryByText("fixture data")).toBeNull();
  });

  it("gives two Systems distinct states and chips", async () => {
    stubSystems([evolving, awaiting]);
    renderApp("/");
    await screen.findByRole("link", { name: /Alpha/ });
    const a = card(/Alpha/);
    const b = card(/Beta/);
    expect(a.querySelector("a")!.getAttribute("data-state")).toBe("evolving");
    expect(b.querySelector("a")!.getAttribute("data-state")).toBe("attention");
    expect(within(a).getByText("1 realization evolving")).toBeTruthy();
    expect(within(a).getByText("2 pending realizations")).toBeTruthy();
    expect(within(a).getByText("not built")).toBeTruthy();
    expect(within(a).getByText("build running")).toBeTruthy();
    expect(within(b).getByText("1 awaiting review")).toBeTruthy();
    expect(within(b).getByText("deployed")).toBeTruthy();
    expect(within(b).getByText("build passed").getAttribute("data-tone")).toBe("pass");
    expect(within(a).getByText("updated 5 min ago")).toBeTruthy();
    expect(within(a).getByText("Phase: realizing")).toBeTruthy();
  });

  it("says unknown for a null deployment and never uses the success tone without a passed build", async () => {
    stubSystems([evolving, { ...base, systemId: "system.c", title: "Gamma", head: null, updatedAt: "" }]);
    const { container } = renderApp("/");
    await screen.findByRole("link", { name: /Alpha/ });
    expect(within(card(/Alpha/)).getByText("not deployed, unknown")).toBeTruthy();
    const c = card(/Gamma/);
    expect(within(c).getByText("not deployed, unknown")).toBeTruthy();
    expect(within(c).getByText("unknown")).toBeTruthy();
    expect(within(c).getByText("updated unknown")).toBeTruthy();
    expect(container.querySelector('[data-tone="pass"]')).toBeNull();
  });

  it("says the API could not be reached on error", () => {
    const onRetry = vi.fn();
    render(<MemoryRouter><HomeContent systems={undefined} isLoading={false} isError onRetry={onRetry} /></MemoryRouter>);
    expect(screen.getByText("Could not reach the platform API.")).toBeTruthy();
    act(() => screen.getByRole("button", { name: "Try again" }).click());
    expect(onRetry).toHaveBeenCalled();
  });
});
