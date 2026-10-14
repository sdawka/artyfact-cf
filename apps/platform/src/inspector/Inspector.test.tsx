import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { ModelProvider } from "@/model/useModel";
import { useAtlasNavigation } from "@/model/useAtlasNavigation";
import { InspectorDrawer } from "./InspectorDrawer";
import { renderApp } from "@/testing/render";
import { registerTab } from "./tabRegistry";

describe("Inspector tab registry", () => {
  it("lets a slice replace a tab's content", async () => {
    renderApp("/s/system.peopling/r/head/overview?focus=screen.people");
    const inspector = await screen.findByRole("complementary", { name: "Inspector" });
    act(() => within(inspector).getByRole("tab", { name: /^Evidence/ }).click());
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


function AtlasProbe() {
  const n = useAtlasNavigation();
  return <><button onClick={() => n.showDetails()}>Details</button><InspectorDrawer /></>;
}
const atlasRoutes = [{ path: "/s/:systemId/r/:rev/:view", element: <ModelProvider bundle={fixtureBundle()}><AtlasProbe /></ModelProvider> }];
describe("Map Details", () => {
  it("selects without opening Inspector, explicitly opens Details, and closes without losing selection", () => {
    const { router } = renderApp("/s/system.peopling/r/head/map?scope=environment&focus=screen.people", atlasRoutes);
    expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull();
    act(() => screen.getByRole("button", { name: "Details" }).click());
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeTruthy();
    act(() => screen.getByRole("button", { name: "Close inspector" }).click());
    expect(screen.queryByRole("complementary", { name: "Inspector" })).toBeNull();
    const qs = new URLSearchParams(router.state.location.search);
    expect(qs.get("focus")).toBe("screen.people");
    expect(qs.get("scope")).toBe("environment");
    expect(qs.has("inspect")).toBe(false);
  });
  it("opens a focused object automatically in other views", () => {
    renderApp("/s/system.peopling/r/head/theory?scope=environment&focus=screen.people", atlasRoutes);
    expect(screen.getByRole("complementary", { name: "Inspector" })).toBeTruthy();
  });
});
