import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { fieldValue, kindViews } from "@/model/kinds";
import { qk } from "@/api/queries";
import { renderApp } from "@/testing/render";

const at = (id: string) => `/s/system.peopling/r/head/overview?focus=${id}`;
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^./, (c) => c.toUpperCase());

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
    const body = box.querySelector("[data-node-fields]")!;
    expect(within(body as HTMLElement).getAllByRole("term").map((t) => t.textContent).slice(0, expected.length)).toEqual(expected);
    expect(box.querySelector("[data-inspector-summary]")?.textContent).toBe(node.description);
    expect(within(box).getByRole("heading", { level: 2 }).textContent).toContain(node.name);
  });

  it("lists fields the template does not declare after the hinted ones", async () => {
    const bundle = structuredClone(fixtureBundle());
    const node = bundle.model.nodes.find((n) => n.id === "policy.ownerOnly")! as unknown as Record<string, unknown>;
    node.reviewNote = "Checked by the owner";
    renderApp(at("policy.ownerOnly"), undefined, (qc) => qc.setQueryData(qk.model("system.peopling", "head"), bundle));
    const box = await screen.findByRole("complementary", { name: "Inspector" });
    const terms = within(box.querySelector<HTMLElement>("[data-node-fields]")!).getAllByRole("term").map((t) => t.textContent);
    expect(terms.at(-1)).toBe("Review note");
    expect(terms.indexOf("Mode")).toBeLessThan(terms.indexOf("Review note"));
    expect(within(box).getByText("Checked by the owner")).toBeTruthy();
  });

  it("falls back to the raw dump for a kind no template declares", async () => {
    const bundle = structuredClone(fixtureBundle());
    const node = bundle.model.nodes.find((n) => n.id === "policy.ownerOnly")! as unknown as Record<string, unknown>;
    node.kind = "gizmo";
    node.sprocket = "left-handed";
    renderApp(at("policy.ownerOnly"), undefined, (qc) => qc.setQueryData(qk.model("system.peopling", "head"), bundle));
    const box = await screen.findByRole("complementary", { name: "Inspector" });
    expect(await within(box).findByText("left-handed")).toBeTruthy();
    expect(within(box).getByText("Sprocket")).toBeTruthy();
    expect(box.querySelector("[data-node-body]")).toBeNull();
  });
});
