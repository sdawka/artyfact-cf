import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { renderApp } from "@/testing/render";
import { HomeContent, PartsContent } from "./index";
import type { CardSummary } from "./signifiers";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const base: CardSummary = {
  systemId: "system.a", title: "Alpha", head: "sc-2", genomeRepo: "g", appRepo: "a", genomeCommit: "g".repeat(40),
  phase: "realizing", evolutionCounts: {}, updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};
const evolving: CardSummary = {
  ...base,
  signifiers: ["evolving", "not-fully-built"],
  realizationCounts: { evolving: 1, pending: 0, awaitingAdmin: 0, awaitingReview: 0 },
  latestBuild: { id: "b1", status: "running", kind: "production", commit: "c".repeat(40) },
  deployment: { production: null, previews: 0 },
  deployState: "none",
};
const awaiting: CardSummary = {
  ...base,
  systemId: "system.b", title: "Beta",
  signifiers: ["evolving", "awaiting-admin", "built", "deployed"],
  realizationCounts: { evolving: 1, pending: 0, awaitingAdmin: 1, awaitingReview: 1 },
  latestBuild: { id: "b2", status: "passed", kind: "production", commit: "d".repeat(40) },
  deployment: {
    production: { id: "d1", kind: "production", status: "live", repo: "app", commit: "d".repeat(40), by: "admin", createdAt: "", updatedAt: "" },
    previews: 1,
  },
  deployState: "live",
};

const stubSystems = (systems: CardSummary[]) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url) === "/api/systems" ? json(200, { systems }) : json(404, {}))));

const card = (name: RegExp) => within(screen.getByRole("list", { name: "Systems" })).getByRole("link", { name: new RegExp(`^(?:${name.source})$`) }).closest("li")!;

describe("Home", () => {
  it("never displays System-private Parts in the public catalog", () => {
    renderApp("/", [{ path: "/", element: <PartsContent parts={[{ partId: "part.private", version: "1.0.0", name: "Private package", scope: { kind: "system", systemId: "system.a" }, digest: "sha256:private", publishedAt: "", dependencies: [] }]} isLoading={false} isError={false} /> }]);
    expect(screen.queryByRole("link", { name: "Private package" })).toBeNull();
    expect(screen.getByText("No reusable Parts published yet.")).toBeTruthy();
  });

  it("shows the fixture System in fixture mode and opens its Overview", async () => {
    const { router } = renderApp("/");
    const link = await screen.findByRole("link", { name: /^Keep in Touch$/ });
    expect(screen.getByText("fixture data")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry API" })).toBeTruthy();
    act(() => link.click());
    await waitFor(() => expect(router.state.location.pathname).toBe("/s/system.keep-in-touch/r/head/things/thing.webapp"));
  });

  it("shows the empty state with an init link when the API has no Systems", async () => {
    stubSystems([]);
    renderApp("/");
    expect(await screen.findByText("No Systems yet.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Import one with artyfact init" })).toBeTruthy();
    expect(screen.queryByText("fixture data")).toBeNull();
  });

  it("gives two Systems a headline, a deploy line and a sort by attention", async () => {
    stubSystems([evolving, awaiting]);
    renderApp("/");
    await screen.findByRole("link", { name: /^Alpha$/ });
    // Each card link is named by the System title only; the body is content, not part of the name.
    const names = within(screen.getByRole("list", { name: "Systems" })).getAllByRole("link").map((l) => l.getAttribute("aria-labelledby") && document.getElementById(l.getAttribute("aria-labelledby")!)?.textContent).filter(Boolean);
    expect(names).toEqual(["Beta", "Alpha"]); // attention first
    const a = card(/Alpha/);
    const b = card(/Beta/);
    expect(a.querySelector("a")!.getAttribute("data-state")).toBe("evolving");
    expect(b.querySelector("a")!.getAttribute("data-state")).toBe("attention");
    expect(within(a).getByRole("link", { name: "Describe a change to Alpha" }).getAttribute("href")).toBe(`/s/${encodeURIComponent(evolving.systemId)}/r/head/work?panel=intent`);
    expect(within(a).queryByRole("link", { name: "Review Alpha" })).toBeNull();
    expect(within(b).getByRole("link", { name: "Review Beta" }).getAttribute("href")).toBe("/s/system.b/r/head/review");
    expect(within(a).getByText("1 realization evolving")).toBeTruthy();
    expect(within(a).queryByText("2 pending realizations")).toBeNull();
    expect(within(b).getByText("1 awaits your review")).toBeTruthy();
    expect(within(b).getByText(/deployed/).getAttribute("data-tone")).toBe("neutral");
    expect(within(b).getByText("build passed").getAttribute("data-tone")).toBe("pass");
    expect(within(a).getByText("build running").getAttribute("data-tone")).toBe("neutral");
    expect(within(a).getByText("updated 5 min ago")).toBeTruthy();
    expect(within(a).getByText("Phase: realizing")).toBeTruthy();
    expect(within(b).queryByText("observed")).toBeNull();
  });

  it("lists what waits on a person in the Needs you ledger", async () => {
    stubSystems([evolving, awaiting, { ...base, systemId: "system.c", title: "Gamma", deployState: "failed" }, { ...base, systemId: "system.d", title: "Delta", deployState: "behind" }]);
    renderApp("/");
    const ledger = await screen.findByRole("region", { name: "Needs you" });
    const rows = within(ledger).getAllByRole("listitem").map((li) => [li.textContent, li.querySelector("a")!.getAttribute("href")]);
    expect(rows).toEqual([
      ["Beta · 1 awaits your review", "/s/system.b/r/head/review"],
      ["Gamma · deploy failed", "/s/system.c/r/head/phenome"],
      ["Delta · deployed, behind", "/s/system.d/r/head/phenome"],
    ]);
  });

  it("counts app candidates the way the Review rail does, not as evolving", async () => {
    // Two submitted app candidates and nothing for an admin: the server's awaitingReview is the rail's number.
    const apps: CardSummary = { ...evolving, systemId: "system.apps", title: "Apps", signifiers: ["evolving", "pending-realization"], realizationCounts: { evolving: 1, pending: 2, awaitingAdmin: 0, awaitingReview: 2 } };
    stubSystems([apps]);
    renderApp("/");
    const ledger = await screen.findByRole("region", { name: "Needs you" });
    expect(within(ledger).getByRole("listitem").textContent).toBe("Apps · 2 await your review");
    const a = card(/Apps/);
    expect(within(a).getByText("2 await your review")).toBeTruthy();
    expect(a.querySelector("a")!.getAttribute("data-state")).toBe("attention");
    expect(within(a).getByRole("link", { name: "Review Apps" })).toBeTruthy();
  });

  it("says nothing is waiting when no System needs a decision", async () => {
    stubSystems([evolving]);
    renderApp("/");
    expect(await screen.findByText("Nothing is waiting on you.")).toBeTruthy();
  });

  it("opens a Home-scoped palette over Systems and Parts from Go to…", async () => {
    stubSystems([evolving, awaiting]);
    const { router } = renderApp("/");
    await screen.findByRole("link", { name: /^Alpha$/ });
    act(() => screen.getByRole("button", { name: /Go to…/ }).click());
    const option = await screen.findByRole("option", { name: /Alpha/ });
    expect(screen.getByRole("option", { name: /Beta/ })).toBeTruthy();
    act(() => option.click());
    await waitFor(() => expect(router.state.location.pathname).toBe("/s/system.a"));
  });

  it("says unknown for a null deployment and never uses the success tone without a passed build", async () => {
    stubSystems([evolving, { ...base, systemId: "system.c", title: "Gamma", head: null, updatedAt: "" }]);
    const { container } = renderApp("/");
    await screen.findByRole("link", { name: /^Alpha$/ });
    expect(within(card(/Alpha/)).getByText("not deployed, unknown")).toBeTruthy();
    const c = card(/Gamma/);
    expect(within(c).getByText("not deployed, unknown")).toBeTruthy();
    expect(within(c).getByText("quiet")).toBeTruthy();
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

  it("keeps reusable Parts separate from Systems and explains an empty catalog", () => {
    render(<MemoryRouter><PartsContent parts={[]} isLoading={false} isError={false} /></MemoryRouter>);
    expect(screen.getByText("No reusable Parts published yet.")).toBeTruthy();
    cleanup();
    render(<MemoryRouter><PartsContent parts={[{ partId: "part.ui.buttons", version: "2.1.0", name: "Button system", scope: { kind: "shared" }, digest: "sha256:test", publishedAt: "2026-10-12T00:00:00Z", dependencies: [] }]} isLoading={false} isError={false} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Button system" }).getAttribute("href")).toBe("/parts/part.ui.buttons/2.1.0");
  });
});
