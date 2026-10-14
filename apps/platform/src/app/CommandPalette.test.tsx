import "@/views/map/testing/flowEnv";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";

const BASE = "/s/system.peopling/r/head";

describe("CommandPalette", () => {
  it("opens with ⌘K, filters by id or name, and Enter focuses in the best view", async () => {
    const { router } = renderApp(`${BASE}/overview?layer=proteome`);
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    await act(async () => void fireEvent.keyDown(window, { key: "k", metaKey: true }));
    const dialog = await screen.findByRole("dialog");
    const all = within(dialog).getAllByRole("option").length;
    expect(all).toBeGreaterThanOrEqual(40);

    const input = within(dialog).getByRole("combobox");
    await act(async () => void fireEvent.change(input, { target: { value: "AddContactDialog.save" } }));
    await waitFor(() => {
      const options = within(dialog).getAllByRole("option");
      expect(options.length).toBeLessThan(all);
      expect(options[0]!.textContent).toContain("affordance.AddContactDialog.save");
      expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    });

    await act(async () => void fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`${BASE}/map`);
      const qs = new URLSearchParams(router.state.location.search);
      expect(qs.get("focus")).toBe("affordance.AddContactDialog.save");
      expect(qs.get("layer")).toBe("proteome");
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it.each(['map', 'overview'])('Go-to from %s with remembered environment reveals a searched leaf', async (view) => {
  const { router } = renderApp(`${BASE}/${view}?scope=environment`);
  if (view === 'map') await waitFor(() => expect(document.querySelector('[data-map-node="system.peopling"]')).not.toBeNull());
  else await screen.findByRole('heading', { level: 1, name: 'Peopling' });
  await act(async () => void fireEvent.keyDown(window, { key: 'k', metaKey: true }));
  const dialog = await screen.findByRole('dialog');
  const input = within(dialog).getByRole('combobox');
  await act(async () => void fireEvent.change(input, { target: { value: 'AddContactDialog.save' } }));
  await waitFor(() => expect(within(dialog).getAllByRole('option')[0]!.getAttribute('aria-selected')).toBe('true'));
  await act(async () => void fireEvent.keyDown(input, { key: 'Enter' }));
  await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('focus')).toBe('affordance.AddContactDialog.save'));
  expect(document.querySelector('[data-map-node="affordance.AddContactDialog.save"]')).not.toBeNull();
  const params = new URLSearchParams(router.state.location.search);
  expect(params.get('scope')).toBe('component.AddContactDialog');
  expect(params.has('inspect')).toBe(false);
  expect(router.state.historyAction).toBe('PUSH');
  await act(() => router.navigate(-1));
  expect(new URLSearchParams(router.state.location.search).get('scope')).toBe('environment');
});

  it("matches names as keywords and sends theory objects to Theory", async () => {
    const { router } = renderApp(`${BASE}/overview`);
    await screen.findByRole("heading", { level: 1, name: "Peopling" });
    await act(async () => void fireEvent.keyDown(window, { key: "k", ctrlKey: true }));
    const dialog = await screen.findByRole("dialog");
    const input = within(dialog).getByRole("combobox");
    await act(async () => void fireEvent.change(input, { target: { value: "Remembering" } }));
    await waitFor(() => {
      const first = within(dialog).getAllByRole("option")[0]!;
      expect(first.textContent).toContain("T1");
      expect(first.getAttribute("aria-selected")).toBe("true");
    });
    await act(async () => void fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`${BASE}/theory`);
      expect(new URLSearchParams(router.state.location.search).get("focus")).toBe("T1");
    });
  });
});
