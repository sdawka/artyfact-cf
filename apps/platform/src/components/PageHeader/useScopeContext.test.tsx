import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { ModelProvider } from "@/model/useModel";
import { renderApp } from "@/testing/render";
import { useScopeContext } from "./useScopeContext";

function Probe() {
  const crumbs = useScopeContext();
  return <p data-testid="crumbs">{crumbs.map((c) => `${c.label}${c.to ? `>${c.to}` : ""}`).join(" | ")}</p>;
}
const element = <ModelProvider bundle={fixtureBundle()}><Probe /></ModelProvider>;
const routes = [
  { path: "/s/:systemId/r/:rev/:view", element },
  { path: "/s/:systemId/r/:rev/things/:thingId", element },
  { path: "/s/:systemId/r/:rev/things/:thingId/:view", element },
];
const text = async () => (await screen.findByTestId("crumbs")).textContent;

describe("useScopeContext", () => {
  it("is empty for a System-wide view", async () => {
    renderApp("/s/system.peopling/r/head/work", routes);
    expect(await text()).toBe("");
  });

  it("System / Thing / View inside a Thing workspace, the view as the current item", async () => {
    renderApp("/s/system.peopling/r/head/things/thing.webapp/work", routes);
    expect(await text()).toBe("Peopling>/s/system.peopling/r/head/overview | Peopling web app>/s/system.peopling/r/head/things/thing.webapp | Work");
  });

  it("the Thing is current on its own workspace", async () => {
    renderApp("/s/system.peopling/r/head/things/thing.webapp", routes);
    expect(await text()).toMatch(/\| Peopling web app$/);
  });

  it("Environment / System / … / node on a Map scope", async () => {
    renderApp("/s/system.peopling/r/head/map?scope=thing.webapp", routes);
    expect(await text()).toBe("Environment>/s/system.peopling/r/head/map?scope=environment | Peopling>/s/system.peopling/r/head/map?scope=system.peopling | Peopling web app");
  });
});
