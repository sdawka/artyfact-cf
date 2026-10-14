import { act, screen } from "@testing-library/react";
import { useParams } from "react-router";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { renderApp } from "@/testing/render";
import { ModelProvider } from "./useModel";
import { useAtlasNavigation } from "./useAtlasNavigation";

const BASE = "/s/system.peopling/r/head";
function Probe() {
  const n = useAtlasNavigation();
  return <><output>{n.scope}</output>
    <button onClick={() => n.locate("affordance.AddContactDialog.save")}>Locate leaf</button>
    <button onClick={() => n.locate("system.peopling")}>Locate System</button>
    <button onClick={() => n.locate("ext.owner")}>Locate external</button>
    <button onClick={() => n.select("screen.people")}>Select</button>
    <button onClick={() => n.showDetails()}>Details</button>
    <button onClick={() => n.closeDetails()}>Close</button>
    <button onClick={() => n.enter("environment")}>Environment</button>
    <button onClick={() => n.enter("system.peopling")}>System</button>
    <button onClick={() => n.enter("thing.webapp")}>Thing</button>
    <button onClick={() => n.enter("entity.ContactRecord")}>Leaf</button>
    <button onClick={() => n.up()}>Up</button>
  </>;
}
function ProbeProvider() {
  const { systemId, rev } = useParams();
  const bundle = fixtureBundle();
  bundle.systemId = systemId!;
  bundle.model.system.id = systemId!;
  if (rev === "previous" || systemId !== "system.peopling") {
    bundle.model.nodes = bundle.model.nodes.filter((n) => n.id !== "section.domain");
  }
  return <ModelProvider bundle={bundle}><Probe /></ModelProvider>;
}
const routes = [
  { path: "/s/:systemId/r/:rev/things/:thingId/overview", element: <ProbeProvider /> },
  { path: "/s/:systemId/r/:rev/map", element: <ProbeProvider /> },
  { path: "/s/:systemId/r/:rev/things/:thingId/map", element: <ProbeProvider /> },
];
const click = (name: string) => act(() => screen.getByRole("button", { name }).click());
const params = (r: ReturnType<typeof renderApp>) => new URLSearchParams(r.router.state.location.search);

describe("atlas URL navigation", () => {
  it("locates a leaf with scope and selection in one navigation entry", async () => {
    const r = renderApp(`${BASE}/map?scope=environment&layer=phenome&candidates=cand.a`, routes);
    click("Locate leaf");
    expect(params(r).get("scope")).toBe("component.AddContactDialog");
    expect(params(r).get("focus")).toBe("affordance.AddContactDialog.save");
    expect(params(r).has("inspect")).toBe(false);
    expect(params(r).get("layer")).toBe("phenome");
    expect(params(r).get("candidates")).toBe("cand.a");
    expect(r.router.state.historyAction).toBe("PUSH");
    expect(r.router.state.location.state).toEqual({ atlasLocate: "affordance.AddContactDialog.save" });
    await act(() => r.router.navigate(-1));
    expect(params(r).get("scope")).toBe("environment");
    expect(params(r).has("focus")).toBe(false);
  });
  it("targets the explicit Thing Map path when locating from another Thing view", () => {
    const r = renderApp(`${BASE}/things/thing.webapp/overview?scope=environment&layer=proteome`, routes);
    click("Locate leaf");
    expect(r.router.state.location.pathname).toBe(`${BASE}/things/thing.webapp/map`);
    expect(params(r).get("scope")).toBe("component.AddContactDialog");
    expect(params(r).get("focus")).toBe("affordance.AddContactDialog.save");
    expect(r.router.state.historyAction).toBe("PUSH");
  });
  it("locates root and externals safely at environment, escaping a Thing boundary", () => {
    const r = renderApp(`${BASE}/things/thing.webapp/map?scope=screen.people&inspect=1`, routes);
    click("Locate System");
    expect(params(r).get("scope")).toBe("environment");
    expect(params(r).get("focus")).toBe("system.peopling");
    expect(r.router.state.location.pathname).toBe(`${BASE}/map`);
    click("Locate external");
    expect(params(r).get("focus")).toBe("ext.owner");
    expect(params(r).has("inspect")).toBe(false);
    expect(r.router.state.historyAction).toBe("REPLACE");
  });
  it("starts at environment, preserving explicit scope over legacy focus", () => {
    const r = renderApp(`${BASE}/map?scope=environment&focus=screen.people`, routes);
    expect(screen.getByRole("status").textContent).toBe("environment");
    click("Select");
    expect(params(r).get("scope")).toBe("environment");
    expect(r.router.state.historyAction).toBe("REPLACE");
  });
  it("normalizes a legacy focus to its real containing scope once, then selection stays there", () => {
    const r = renderApp(`${BASE}/map?focus=entity.ContactRecord`, routes);
    expect(screen.getByRole("status").textContent).toBe("section.contacts");
    expect(params(r).get("scope")).toBe("section.contacts");
    click("Select");
    expect(params(r).get("scope")).toBe("section.contacts");
  });
  it("separates replaced selection and Details from pushed depth history", async () => {
    const r = renderApp(`${BASE}/map?scope=environment&layer=phenome`, routes);
    click("System");
    expect(r.router.state.historyAction).toBe("PUSH");
    click("Thing");
    click("Select"); click("Details");
    expect(params(r).get("inspect")).toBe("1");
    expect(params(r).get("focus")).toBe("screen.people");
    expect(r.router.state.historyAction).toBe("REPLACE");
    click("Close");
    expect(params(r).get("inspect")).toBeNull();
    expect(params(r).get("focus")).toBe("screen.people");
    await act(() => r.router.navigate(-1));
    expect(params(r).get("scope")).toBe("system.peopling");
    expect(params(r).get("focus")).toBeNull();
    expect(params(r).get("layer")).toBe("phenome");
  });
  it("jumps directly to environment from a deep Thing boundary in one history entry", async () => {
    const r = renderApp(`${BASE}/things/thing.webapp/map?scope=section.domain&focus=entity.ContactRecord&inspect=1`, routes);
    click("Environment");
    expect(r.router.state.location.pathname).toBe(`${BASE}/map`);
    expect(params(r).get("scope")).toBe("environment");
    expect(params(r).has("focus")).toBe(false);
    expect(params(r).has("inspect")).toBe(false);
    await act(() => r.router.navigate(-1));
    expect(params(r).get("scope")).toBe("section.domain");
  });
  it("allows a direct Thing map to go up to System and environment via canonical routes", () => {
    const r = renderApp(`${BASE}/things/thing.webapp/map`, routes);
    expect(screen.getByRole("status").textContent).toBe("thing.webapp");
    click("Up");
    expect(r.router.state.location.pathname).toBe(`${BASE}/map`);
    expect(params(r).get("scope")).toBe("system.peopling");
    click("Up");
    expect(params(r).get("scope")).toBe("environment");
    const key = r.router.state.location.key;
    click("Up");
    expect(r.router.state.location.key).toBe(key);
  });
  it("normalizes an explicit leaf to its parent without allowing focus to override it", () => {
    const r = renderApp(`${BASE}/map?scope=entity.ContactRecord&focus=screen.people`, routes);
    expect(params(r).get("scope")).toBe("section.contacts");
  });
  it("resets stale explicit scope instead of recovering depth from selected focus", () => {
    const r = renderApp(`${BASE}/map?scope=thing.deleted&focus=screen.people`, routes);
    expect(params(r).get("scope")).toBe("environment");
  });
  it("does not enter a leaf", () => {
    const r = renderApp(`${BASE}/map?scope=environment`, routes);
    click("Leaf");
    expect(params(r).get("scope")).toBe("environment");
  });
  it("resets invalid scope when the route changes System or revision", async () => {
    const r = renderApp(`${BASE}/map?scope=thing.missing`, routes);
    expect(params(r).get("scope")).toBe("environment");
    await act(() => r.router.navigate("/s/system.peopling/r/previous/map?scope=section.domain&focus=screen.people"));
    expect(params(r).get("scope")).toBe("environment");
    await act(() => r.router.navigate("/s/system.other/r/head/map?scope=section.domain&focus=screen.people"));
    expect(params(r).get("scope")).toBe("environment");
  });
});
