import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { qk } from "@/api/queries";
import { fixtureBundle } from "@/api/fixtures";
import { renderApp } from "@/testing/render";

const url = "/s/system.keep-in-touch/r/head/map?focus=operation.contact.save";
const withDerived = (qc: Parameters<NonNullable<Parameters<typeof renderApp>[2]>>[0]) =>
  qc.setQueryData(qk.readiness("system.keep-in-touch", "head"), {
    ...fixtureBundle().readiness,
    derived: {
      governedBy: [["operation.contact.save", "policy.ownerOnly"], ["operation.other", "policy.ownerOnly"]],
      mutating: [["operation.contact.save"]],
      ancestor: [["operation.contact.save", "thing.webapp"]],
    },
  });

async function openRules() {
  const inspector = await screen.findByRole("complementary", { name: "Inspector" });
  fireEvent.click(within(inspector).getByRole("tab", { name: "Rules & claims" }));
  return inspector;
}

describe("RulesTab", () => {
  it("lists the criterion on the invoking affordance with owner, subject and target lines", async () => {
    renderApp(url, undefined, withDerived);
    const inspector = await openRules();
    const card = (await within(inspector).findByTitle("Criterion: C.webapp.contact.save")).closest("li")!;
    expect(within(card).getByText("Owner")).toBeTruthy();
    expect(within(card).getByText("Subject")).toBeTruthy();
    expect(within(card).getByText(/artifact · gates candidate, promotion/)).toBeTruthy();
    expect(within(card).getByText(/not-run/)).toBeTruthy();
  });

  it("lists governedBy and mutating with an expandable derivation, hides ancestor and other nodes", async () => {
    renderApp(url, undefined, withDerived);
    const inspector = await openRules();
    const section = await within(inspector).findByRole("region", { name: "Derived obligations" });
    expect(within(section).getByText("governedBy")).toBeTruthy();
    expect(within(section).getByText("mutating")).toBeTruthy();
    expect(within(section).queryByText("ancestor")).toBeNull();
    expect(within(section).getAllByRole("listitem").length).toBe(2);
    fireEvent.click(within(section).getByRole("button", { name: /Explain.*governedBy/ }));
    await waitFor(() => expect(within(section).getByRole("tree")).toBeTruthy());
  });

  it("omits derived obligations when the report has none", async () => {
    renderApp(url);
    const inspector = await openRules();
    await within(inspector).findByRole("region", { name: "Criteria" });
    expect(within(inspector).queryByRole("region", { name: "Derived obligations" })).toBeNull();
  });
});
