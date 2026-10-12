import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";
import { registerTab } from "./tabRegistry";

describe("Inspector tab registry", () => {
  it("lets a slice replace a tab's content", async () => {
    renderApp("/s/system.keep-in-touch/r/head/overview?focus=screen.people");
    const inspector = await screen.findByRole("complementary", { name: "Inspector" });
    act(() => within(inspector).getByRole("tab", { name: "Evidence" }).click());
    expect(within(inspector).queryByText("custom evidence for screen.people")).toBeNull();
    let unregister = () => {};
    act(() => {
      unregister = registerTab("evidence", ({ entry }) => <p>custom evidence for {entry.id}</p>);
    });
    await waitFor(() => expect(within(inspector).getByText("custom evidence for screen.people")).toBeTruthy());
    act(() => unregister());
    await waitFor(() => expect(within(inspector).queryByText("custom evidence for screen.people")).toBeNull());
  });
});
