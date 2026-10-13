import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";
import { useKeepParams, useSelection } from "./useSelection";

function Probe() {
  const s = useSelection();
  const href = useKeepParams();
  return (
    <div>
      <output data-testid="sel">{JSON.stringify({ focus: s.focusId, layer: s.layer, candidates: s.candidates })}</output>
      <output data-testid="href">{href("changelog")}</output>
      <button onClick={() => s.setFocus("screen.people")}>focus</button>
      <button onClick={() => s.setFocus("screen.people", { view: "journeys" })}>journeys</button>
      <button onClick={() => s.setLayer("phenome")}>layer</button>
      <button onClick={() => s.setCandidates(["c1", "c2"])}>candidates</button>
      <button onClick={() => s.clear()}>clear</button>
    </div>
  );
}
const routes = [{ path: "/s/:systemId/r/:rev/:view", element: <Probe /> }, { path: "/s/:systemId/r/:rev/things/:thingId/:view", element: <Probe /> }];
const sel = () => JSON.parse(screen.getByTestId("sel").textContent!) as { focus: string | null; layer: string; candidates: string[] };
const click = (name: string) => act(() => screen.getByRole("button", { name }).click());

describe("useSelection", () => {
  it("keeps the Thing workspace boundary when navigating views", () => {
    const { router } = renderApp("/s/system.peopling/r/head/things/thing.webapp/map?layer=phenome", routes);
    click("journeys");
    expect(router.state.location.pathname).toBe("/s/system.peopling/r/head/things/thing.webapp/journeys");
    expect(new URLSearchParams(router.state.location.search).get("focus")).toBe("screen.people");
    expect(screen.getByTestId("href").textContent).toBe("/s/system.peopling/r/head/things/thing.webapp/changelog?focus=screen.people&layer=phenome");
  });

  it("defaults layer to genome and parses candidates", () => {
    renderApp("/s/system.peopling/r/head/map?candidates=a,b", routes);
    expect(sel()).toEqual({ focus: null, layer: "genome", candidates: ["a", "b"] });
  });

  it("setFocus keeps the layer and other params", () => {
    const { router } = renderApp("/s/system.peopling/r/head/map?layer=phenome&journey=J.contacts", routes);
    click("focus");
    expect(sel()).toMatchObject({ focus: "screen.people", layer: "phenome" });
    const qs = new URLSearchParams(router.state.location.search);
    expect(qs.get("journey")).toBe("J.contacts");
  });

  it("switching view keeps focus, layer and candidates but drops view-specific params", () => {
    const { router } = renderApp(
      "/s/system.peopling/r/head/map?focus=entity.ContactRecord&layer=proteome&candidates=c1&journey=J.contacts",
      routes,
    );
    click("journeys");
    expect(router.state.location.pathname).toBe("/s/system.peopling/r/head/journeys");
    const qs = new URLSearchParams(router.state.location.search);
    expect(qs.get("focus")).toBe("screen.people");
    expect(qs.get("layer")).toBe("proteome");
    expect(qs.get("candidates")).toBe("c1");
    expect(qs.get("journey")).toBeNull();
  });

  it("setLayer, setCandidates and clear update the URL", () => {
    const { router } = renderApp("/s/system.peopling/r/head/map?focus=screen.people", routes);
    click("layer");
    click("candidates");
    expect(sel()).toEqual({ focus: "screen.people", layer: "phenome", candidates: ["c1", "c2"] });
    click("clear");
    expect(sel().focus).toBeNull();
    expect(new URLSearchParams(router.state.location.search).get("layer")).toBe("phenome");
  });

  it("useKeepParams builds view links that carry the global params", () => {
    renderApp("/s/system.peopling/r/r1/map?focus=T1&layer=phenome&journey=J.contacts", routes);
    expect(screen.getByTestId("href").textContent).toBe("/s/system.peopling/r/r1/changelog?focus=T1&layer=phenome");
  });
});
