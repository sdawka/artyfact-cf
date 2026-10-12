import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";

async function open(id: string) {
  renderApp(`/s/system.keep-in-touch/r/head/map?focus=${id}`);
  return screen.findByRole("complementary", { name: "Inspector" });
}

describe("Inspector kind bodies", () => {
  it("EntityBody renders the fields table, storedIn and governed-by chips", async () => {
    const i = await open("entity.Account");
    expect(await within(i).findByRole("columnheader", { name: "Type" })).toBeTruthy();
    expect(within(i).getByText("identitySubject")).toBeTruthy();
    expect(within(i).getByText("Stored in")).toBeTruthy();
    expect(within(i).getByTitle("Binding: binding.contactsStore")).toBeTruthy();
    expect(within(i).getByTitle("Policy: policy.ownerOnly")).toBeTruthy();
  });

  it("OperationBody lists actor, effects and who invokes it", async () => {
    const i = await open("operation.contact.save");
    expect(await within(i).findByText("Invoked by")).toBeTruthy();
    expect(within(i).getByText("Effects")).toBeTruthy();
    expect(within(i).getByTitle("Affordance: affordance.AddContactDialog.save")).toBeTruthy();
  });

  it("PolicyBody shows the mode and what it governs", async () => {
    const i = await open("policy.ownerOnly");
    expect(await within(i).findByText("Mode")).toBeTruthy();
    expect(within(i).getByText("owner-only")).toBeTruthy();
    expect(within(i).getByText("Governs")).toBeTruthy();
  });

  it("CriterionBody shows hooks with engine, tier and binding", async () => {
    const i = await open("C.webapp.contact.save");
    expect(await within(i).findByText("Hooks")).toBeTruthy();
    expect(within(i).getByText(/· defined|· implementation-missing|· bound/)).toBeTruthy();
  });

  it("ThingBody lists sections and artifacts", async () => {
    const i = await open("thing.webapp");
    expect(await within(i).findByText("Sections")).toBeTruthy();
    expect(within(i).getByText("Artifacts")).toBeTruthy();
  });

  it("SystemBody lists phase, things and purposes", async () => {
    const i = await open("system.keep-in-touch");
    expect(await within(i).findByText("Phase")).toBeTruthy();
    expect(within(i).getByTitle("Purpose: P1")).toBeTruthy();
  });

  it("SectionBody rolls up conformance without green when nothing ran", async () => {
    const i = await open("section.domain");
    expect(await within(i).findByText("Conformance in this section")).toBeTruthy();
    expect(within(i).getByText(/0 pass/)).toBeTruthy();
  });

  it("RequirementBody shows text and the GD features it refines", async () => {
    const id = "S.webapp.scope";
    const i = await open(id);
    expect(await within(i).findByText("Refines (GD)")).toBeTruthy();
  });
});

describe("hook body", () => {
  it("HookBody shows engine, tier and binding", async () => {
    const i = await open("hook.system.structure");
    expect(await within(i).findByText("Engine · tier")).toBeTruthy();
    expect(within(i).getByText("Binding")).toBeTruthy();
  });
});
