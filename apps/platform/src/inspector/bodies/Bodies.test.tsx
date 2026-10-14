import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderApp } from "@/testing/render";

async function open(id: string) {
  renderApp(`/s/system.peopling/r/head/map?focus=${id}&inspect=1`);
  return screen.findByRole("complementary", { name: "Inspector" });
}

describe("Inspector kind bodies", () => {
  it("a node body renders a list of records (an entity's fields) as a table", async () => {
    const i = await open("entity.Account");
    expect(await within(i).findByRole("columnheader", { name: "Type" })).toBeTruthy();
    expect(within(i).getByText("identitySubject")).toBeTruthy();
  });

  it("a node body lists the hint fields (an operation's preconditions and effects)", async () => {
    const i = await open("operation.contact.save");
    expect(await within(i).findByText("Preconditions")).toBeTruthy();
    expect(within(i).getByText("Effects")).toBeTruthy();
  });

  it("a node body shows scalar fields (a policy's mode)", async () => {
    const i = await open("policy.ownerOnly");
    expect(await within(i).findByText("Mode")).toBeTruthy();
    expect(within(i).getByText("owner-only")).toBeTruthy();
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
    const i = await open("system.peopling");
    expect(await within(i).findByText("Phase")).toBeTruthy();
    expect(within(i).getByTitle("Purpose: P1")).toBeTruthy();
  });

  it("a container's node body rolls up conformance without green when nothing ran", async () => {
    const i = await open("section.domain");
    expect(await within(i).findByText("Conformance inside")).toBeTruthy();
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
