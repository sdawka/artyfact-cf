import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { SYSTEM, commit } from "../work/testData";

const URL = `/s/${SYSTEM}/r/head/history`;
const older = commit({ id: "aaaa000000000000", decision: { by: "admin", policy: "p", rationale: "First", at: "2026-01-01T00:00:00.000Z" } });
const newer = commit({
  id: "bbbb000000000000", parent: "aaaa000000000000", evolutions: ["evolution.2"],
  decision: { by: "admin", policy: "p", rationale: "Second", at: "2026-01-03T00:00:00.000Z" },
});
const seed = (qc: import("@tanstack/react-query").QueryClient) => qc.setQueryData(qk.history(SYSTEM), { commits: [older, newer] });

describe("History view", () => {
  it("shows the empty state", async () => {
    renderApp(URL);
    expect(await screen.findByText(/No System commits yet/)).toBeTruthy();
  });

  it("renders commits newest first with decision and parent", async () => {
    renderApp(URL, undefined, seed);
    const list = await screen.findByRole("list", { name: /System commits/ });
    const cards = within(list).getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("Second")).toBeTruthy();
    expect(within(cards[1]!).getByText("First")).toBeTruthy();
    expect(within(cards[0]!).getByText("artifacts/webapp@abcdef1234", { exact: false })).toBeTruthy();
    expect(within(cards[0]!).getAllByText("aaaa000000").length).toBeGreaterThan(0);
  });

  it("shows acknowledged advisories as criterion chips", async () => {
    const acked = { ...newer, decision: { ...newer.decision, acknowledged: [{ criterion: "C.webapp.screen.people" }, "C.webapp.exists"] } };
    renderApp(URL, undefined, (qc) => qc.setQueryData(qk.history(SYSTEM), { commits: [older, acked] }));
    const cards = await screen.findAllByRole("article");
    expect(within(cards[0]!).getByText("Advisories acknowledged")).toBeTruthy();
    expect(within(cards[0]!).getByRole("button", { name: /People screen/ })).toBeTruthy();
  });

  it("says history could not be loaded, not that it is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).endsWith("/api/systems")
        ? new Response(JSON.stringify([{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 500 }),
    ));
    renderApp(URL);
    expect(await screen.findByText("Could not load history.")).toBeTruthy();
    expect(screen.queryByText(/No System commits yet/)).toBeNull();
  });

  it("filters by evolution and highlights ?commit=", async () => {
    renderApp(`${URL}?commit=aaaa000000000000`, undefined, seed);
    const first = await screen.findByRole("article", { name: /aaaa000000/ });
    expect(first.getAttribute("aria-current")).toBe("true");
    fireEvent.change(screen.getByLabelText("Evolution"), { target: { value: "evolution.2" } });
    expect(screen.getAllByRole("article")).toHaveLength(1);
  });
});
