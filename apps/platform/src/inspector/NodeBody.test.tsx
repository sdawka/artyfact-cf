import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { fieldValue, kindViews } from "@/model/kinds";
import { renderApp } from "@/testing/render";

const at = (id: string) => `/s/system.keep-in-touch/r/head/overview?focus=${id}`;
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

describe("NodeBody", () => {
  it("renders the kind's fields in view-hint order, title and summary in the header", async () => {
    const model = fixtureBundle().model;
    const view = kindViews(model).of("affordance");
    const node = model.nodes.find((n) => n.id === "affordance.AddContactDialog.save")!;
    const empty = (v: unknown) => v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    const expected = view.fields.filter((f) => f !== view.title && f !== view.summary && !empty(fieldValue(node, f))).map(humanize);
    expect(expected.length).toBeGreaterThan(2);

    renderApp(at(node.id));
    const box = await screen.findByRole("complementary", { name: "Inspector" });
    const body = box.querySelector("[data-node-body]")!;
    expect(within(body as HTMLElement).getAllByRole("term").map((t) => t.textContent)).toEqual(expected);
    expect(box.querySelector("[data-inspector-summary]")?.textContent).toBe(node.description);
    expect(within(box).getByRole("heading", { level: 2 }).textContent).toContain(node.name);
  });
});
