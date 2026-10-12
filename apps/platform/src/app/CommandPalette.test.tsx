import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";

const BASE = "/s/system.keep-in-touch/r/head";

describe("CommandPalette", () => {
  it("opens with ⌘K, filters by id or name, and Enter focuses in the best view", async () => {
    const { router } = renderApp(`${BASE}/overview?layer=proteome`);
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    act(() => void fireEvent.keyDown(window, { key: "k", metaKey: true }));
    const dialog = await screen.findByRole("dialog");
    const all = within(dialog).getAllByRole("option").length;
    expect(all).toBeGreaterThanOrEqual(40);

    const input = within(dialog).getByRole("combobox");
    act(() => void fireEvent.change(input, { target: { value: "AddContactDialog.save" } }));
    await waitFor(() => expect(within(dialog).getAllByRole("option").length).toBeLessThan(all));
    const options = within(dialog).getAllByRole("option");
    expect(options[0]!.textContent).toContain("affordance.AddContactDialog.save");

    act(() => void fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/map`));
    const qs = new URLSearchParams(router.state.location.search);
    expect(qs.get("focus")).toBe("affordance.AddContactDialog.save");
    expect(qs.get("layer")).toBe("proteome");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("matches names as keywords and sends theory objects to Theory", async () => {
    const { router } = renderApp(`${BASE}/overview`);
    await screen.findByRole("heading", { level: 1, name: "Overview" });
    act(() => void fireEvent.keyDown(window, { key: "k", ctrlKey: true }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("combobox");
    act(() => void fireEvent.change(input, { target: { value: "Remembering" } }));
    await waitFor(() => expect(within(dialog).getAllByRole("option")[0]!.textContent).toContain("T1"));
    act(() => void fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`${BASE}/theory`));
    expect(new URLSearchParams(router.state.location.search).get("focus")).toBe("T1");
  });
});
