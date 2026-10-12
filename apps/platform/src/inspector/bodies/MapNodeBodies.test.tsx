import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";

const at = (id: string) => `/s/system.keep-in-touch/r/head/overview?focus=${id}`;
const inspector = () => screen.findByRole("complementary", { name: "Inspector" });

describe("Map slice Inspector bodies", () => {
  it("Screen: route, roles, states and children chips", async () => {
    renderApp(at("screen.people"));
    const box = await inspector();
    expect(await within(box).findByText("/people")).toBeTruthy();
    expect(within(box).getByText("owner")).toBeTruthy();
    expect(within(box).getByText("empty")).toBeTruthy();
    const inside = within(box).getByRole("region", { name: "Inside" });
    expect(within(inside).getByRole("button", { name: /ContactCollection/ })).toBeTruthy();
  });

  it("Component: cardinality", async () => {
    renderApp(at("component.ContactCollection"));
    const box = await inspector();
    expect(await within(box).findByText("exactly one")).toBeTruthy();
  });

  it("Affordance: actor chip, trigger, preconditions, effects, failure", async () => {
    renderApp(at("affordance.AddContactDialog.save"));
    const box = await inspector();
    expect(await within(box).findByText("Owner activates Save in the dialog")).toBeTruthy();
    expect(within(box).getByText("Nonblank name")).toBeTruthy();
    expect(within(box).getByText(/Network error keeps entered values/)).toBeTruthy();
    expect(within(box).getAllByText("Actor").length).toBe(1);
  });
});
