import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { renderApp } from "@/testing/render";
import { ModelProvider } from "./useModel";
import { useStayHref, useThingFilter, type ThingFilter } from "./useThingFilter";

let latest: ThingFilter;
let stay: ReturnType<typeof useStayHref>;
function Probe() {
  latest = useThingFilter();
  stay = useStayHref();
  return <p>{latest.active ? "filtered" : "all"}</p>;
}
const probe = <ModelProvider bundle={fixtureBundle()}><Probe /></ModelProvider>;
const routes = [{ path: "/s/:systemId/r/:rev/things/:thingId/*", element: probe }, { path: "/s/:systemId/r/:rev/*", element: probe }];
const BASE = "/s/system.peopling/r/head";

describe("useThingFilter", () => {
  it("filters inside a Thing path by the Thing's containment and passes everything through at System level", async () => {
    const bundle = fixtureBundle();
    const thing = bundle.model.things[0]!;
    renderApp(`${BASE}/things/${thing.id}/work`, routes);
    expect(await screen.findByText("filtered")).toBeTruthy();
    expect(latest.thingId).toBe(thing.id);
    expect(latest.includesNode(thing.id)).toBe(true);
    expect(latest.includesNode("no.such.node")).toBe(false);
    expect(latest.filter([{ n: [thing.id] }, { n: ["no.such.node"] }], (x) => x.n)).toEqual([{ n: [thing.id] }]);
  });

  it("lifts the filter with ?all=1 and restores it", async () => {
    const thing = fixtureBundle().model.things[0]!;
    renderApp(`${BASE}/things/${thing.id}/work?all=1`, routes);
    expect(await screen.findByText("all")).toBeTruthy();
    expect(latest.showAll).toBe(true);
    expect(latest.thingId).toBeUndefined();
    expect(latest.includesNode("no.such.node")).toBe(true);
    await act(async () => latest.setShowAll(false));
    expect(await screen.findByText("filtered")).toBeTruthy();
  });

  it("does nothing outside a Thing path", async () => {
    renderApp(`${BASE}/work`, routes);
    expect(await screen.findByText("all")).toBeTruthy();
    expect(latest.thing).toBeUndefined();
    expect(latest.filter([1, 2], () => ["x"])).toEqual([1, 2]);
  });

  it("useStayHref keeps a lifted filter on links that stay on the view, and lets extra clear it", async () => {
    const thing = fixtureBundle().model.things[0]!;
    renderApp(`${BASE}/things/${thing.id}/work?all=1&focus=x&evolution=e0`, routes);
    expect(await screen.findByText("all")).toBeTruthy();
    expect(stay("work", { plan: "p1" })).toBe(`${BASE}/things/${thing.id}/work?focus=x&all=1&plan=p1`);
    expect(stay("work", { all: null })).toBe(`${BASE}/things/${thing.id}/work?focus=x`);
  });

  it("useStayHref adds nothing while the filter applies", async () => {
    const thing = fixtureBundle().model.things[0]!;
    renderApp(`${BASE}/things/${thing.id}/work`, routes);
    expect(await screen.findByText("filtered")).toBeTruthy();
    expect(stay("work", { evolution: "e1" })).toBe(`${BASE}/things/${thing.id}/work?evolution=e1`);
  });
});
