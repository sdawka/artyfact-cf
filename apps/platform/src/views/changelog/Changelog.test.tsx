import type { QueryClient } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChangelogRow } from "../../../shared/api";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";
import { SYSTEM, entry, newer, older } from "./testData";

const URL = `/s/${SYSTEM}/r/head/changelog`;
const seed = (rows: ChangelogRow[] = [older, newer]) => (qc: QueryClient) => {
  // Server order is newest first.
  qc.setQueryData(qk.changelog(SYSTEM, undefined), { pages: [{ rows: [...rows].sort((a, b) => b.at.localeCompare(a.at)) }], pageParams: [undefined] });
  qc.setQueryData(qk.changelogEntry(SYSTEM, "sc-2"), entry);
};
const list = () => screen.findByRole("list", { name: "System commits, newest first" });
const rowsOf = (ol: HTMLElement) => within(ol).getAllByRole("listitem").filter((li) => li.parentElement === ol);
const expand = async (name: RegExp) => {
  fireEvent.click(within(await list()).getByRole("button", { name, expanded: false }));
  return screen.findByRole("region", { name: "Genome" });
};

describe("Changelog", () => {
  it("shows an empty state that is never green", async () => {
    const { container } = renderApp(URL);
    expect(await screen.findByText(/No System commits yet/)).toBeTruthy();
    expect(container.querySelector('[data-tone="pass"]')).toBeNull();
  });

  it("lists commits newest first with a summary line, build and deployment chips", async () => {
    renderApp(URL, undefined, seed());
    const rows = rowsOf(await list());
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toMatch(/sc-2/);
    expect(rows[0]!.textContent).toMatch("nodes +2 ~1 −0 · 4 files · 3 criteria");
    expect(rows[0]!.textContent).toMatch(/People screen/);
    expect(rows[0]!.textContent).toMatch(/production build passed/);
    expect(rows[0]!.textContent).toMatch(/production live/);
    expect(rows[1]!.textContent).toMatch(/sc-1/);
    const toggle = within(rows[0]!).getByRole("button", { name: /^sc-2/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(rows[0]!).getByRole("button", { name: "Copy commit id sc-2" })).toBeTruthy();
  });

  it("notes a commit whose Genome is in the v1 format", async () => {
    renderApp(URL, undefined, seed([older, { ...newer, legacyFormat: true }]));
    const rows = rowsOf(await list());
    expect(rows[0]!.textContent).toContain("Genome v1 format — not comparable");
    expect(rows[1]!.textContent).not.toContain("Genome v1 format");
  });

  it("expands into the Genome delta with field before/after", async () => {
    renderApp(URL, undefined, seed());
    const genome = await expand(/sc-2/);
    expect(within(genome).getByText("Added")).toBeTruthy();
    expect(await within(genome).findByLabelText("name before")).toBeTruthy();
    await waitFor(() => expect(within(genome).getByLabelText("name after").textContent).toMatch("People"));
  });

  it("links files to the code view at that commit (removed files at the parent), criteria and deployments", async () => {
    renderApp(URL, undefined, seed());
    await expand(/sc-2/);
    const files = screen.getByRole("region", { name: "Files" });
    expect(within(files).getByRole("link", { name: "src/screens/People.tsx" }).getAttribute("href"))
      .toBe(`/s/${SYSTEM}/r/sc-2/code?repo=app&path=src%2Fscreens%2FPeople.tsx`);
    expect(within(files).getByRole("link", { name: "src/old.ts" }).getAttribute("href")).toBe(`/s/${SYSTEM}/r/sc-1/code?repo=app&path=src%2Fold.ts`);
    expect(within(files).getByRole("link", { name: "thing.webapp/section.ui/screen.people/node.yaml" }).getAttribute("href"))
      .toBe(`/s/${SYSTEM}/r/sc-2/code?repo=genome&path=thing.webapp%2Fsection.ui%2Fscreen.people%2Fnode.yaml`);
    const criteria = screen.getByRole("region", { name: "Criteria" });
    expect(within(criteria).getByRole("link", { name: "C.webapp.screen.people" }).getAttribute("href"))
      .toBe(`/s/${SYSTEM}/r/head/evaluations?criterion=C.webapp.screen.people`);
    expect(within(criteria).getByText("before not-run")).toBeTruthy();
    const deploy = screen.getByRole("region", { name: "Builds and deployment" });
    expect(within(deploy).getByRole("link", { name: "deploy.2" }).getAttribute("href")).toBe(`/s/${SYSTEM}/r/head/phenome?deployment=deploy.2`);
    expect(screen.getByRole("link", { name: "Compare with parent" }).getAttribute("href")).toBe(`/s/${SYSTEM}/r/head/compare?from=sc-1&to=sc-2`);
  });

  it("auto-expands and marks ?commit=", async () => {
    renderApp(`${URL}?commit=sc-2`, undefined, seed());
    const rows = rowsOf(await list());
    expect(rows[0]!.getAttribute("aria-current")).toBe("true");
    expect(rows[1]!.getAttribute("aria-current")).toBeNull();
    expect(within(rows[0]!).getByRole("button", { name: /^sc-2/ }).getAttribute("aria-expanded")).toBe("true");
    expect(await screen.findByRole("region", { name: "Files" })).toBeTruthy();
  });

  it("filters by Evolution", async () => {
    renderApp(URL, undefined, seed());
    await list();
    fireEvent.change(screen.getByLabelText("Evolution"), { target: { value: "evolution.2" } });
    await waitFor(async () => expect(rowsOf(await list())).toHaveLength(1));
  });

  it("says the changelog could not be loaded, not that it is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).endsWith("/api/systems")
        ? new Response(JSON.stringify({ systems: [] }), { status: 200, headers: { "content-type": "application/json" } })
        : new Response("{}", { status: 500 }),
    ));
    renderApp(URL);
    expect(await screen.findByText("Could not load the changelog.")).toBeTruthy();
    expect(screen.queryByText(/No System commits yet/)).toBeNull();
  });

  it("marks commits whose evidence came from the fake provider", async () => {
    renderApp(URL, undefined, seed([older, { ...newer, fakeProvider: true }]));
    const rows = rowsOf(await list());
    expect(within(rows[0]!).getByText("System One: fake provider")).toBeTruthy();
    expect(within(rows[1]!).queryByText("System One: fake provider")).toBeNull();
  });

  it("opens the New Evolution panel from + Evolution, disabled on fixture data", async () => {
    const { router } = renderApp(URL, undefined, seed());
    fireEvent.click(await screen.findByRole("button", { name: "+ Evolution" }));
    await waitFor(() => expect(router.state.location.search).toBe("?panel=new"));
    expect(await screen.findByRole("heading", { name: "New Evolution" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Create Evolution" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/needs the platform API/)).toBeTruthy();
  });
});
