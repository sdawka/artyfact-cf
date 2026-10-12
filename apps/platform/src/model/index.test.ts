import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex, stepId } from "./index";

const ix = buildIndex(fixtureBundle());
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe("buildIndex on the Keep in Touch fixture", () => {
  it("indexes at least 40 objects across kinds", () => {
    expect(ix.entries.length).toBeGreaterThanOrEqual(40);
    expect(ix.byId("screen.people")).toMatchObject({ type: "node", kind: "screen", name: "People" });
    expect(ix.byId("ext.owner")?.kind).toBe("external");
    expect(ix.byId("T1")?.kind).toBe("claim");
    expect(ix.byId("C.webapp.private.owner")?.kind).toBe("criterion");
    expect(ix.byId("J.contacts")?.kind).toBe("journey");
    expect(ix.byId("evolution.1")?.kind).toBe("evolution");
    expect(ix.byId("nope")).toBeUndefined();
  });

  it("lists children of screen.people in declared order", () => {
    expect(ids(ix.children("screen.people"))).toEqual([
      "component.people.PageHeading",
      "component.people.SearchInput",
      "affordance.people.addContact",
      "component.ContactCollection",
      "component.AddContactDialog",
    ]);
    expect(ids(ix.children("system.keep-in-touch"))).toEqual(["thing.webapp"]);
    expect(ix.parent("component.AddContactDialog")?.id).toBe("screen.people");
    expect(ix.children("nope")).toEqual([]);
  });

  it("normalises cross-links: entity.ContactRecord storedIn binding.contactsStore", () => {
    const out = ix.crossLinks("entity.ContactRecord", "out");
    expect(out).toContainEqual(expect.objectContaining({ from: "entity.ContactRecord", rel: "storedIn", to: "binding.contactsStore" }));
    expect(ix.crossLinks("binding.contactsStore", "in").map((l) => l.from)).toContain("entity.ContactRecord");
    // direction: in flips the edge so the policy governs the entity
    expect(ix.crossLinks("policy.ownerOnly", "out")).toContainEqual(
      expect.objectContaining({ from: "policy.ownerOnly", rel: "governs", to: "entity.ContactRecord" }),
    );
    expect(ix.crossLinks("entity.ContactRecord").length).toBe(
      ix.crossLinks("entity.ContactRecord", "out").length + ix.crossLinks("entity.ContactRecord", "in").length,
    );
  });

  it("computes the containment path from the System root", () => {
    expect(ids(ix.path("affordance.AddContactDialog.save"))).toEqual([
      "system.keep-in-touch",
      "thing.webapp",
      "section.ui",
      "screen.people",
      "component.AddContactDialog",
      "affordance.AddContactDialog.save",
    ]);
    expect(ids(ix.path("T1"))).toEqual(["T1"]);
    expect(ix.path("nope")).toEqual([]);
  });

  it("resolves criteria, hooks, journeys and requirements", () => {
    expect(ids(ix.criteriaFor("screen.people"))).toEqual(["C.webapp.screen.people"]);
    expect(ids(ix.criteriaOwnedBy("thing.webapp"))).toHaveLength(4);
    expect(ids(ix.hooksFor("C.webapp.contact.save"))).toEqual(["hook.webapp.contact.save"]);
    expect(ids(ix.journeysFor("screen.people"))).toEqual(["J.contacts"]);
    expect(ids(ix.journeysFor("operation.contact.save"))).toEqual(["J.contacts"]);
    expect(ids(ix.requirementsFor("screen.today"))).toEqual(["S.webapp.screens", "S.webapp.prompts"]);
  });

  it("indexes journey steps under journey-qualified ids", () => {
    const s = stepId("J.contacts", "s4");
    expect(s).toBe("J.contacts.s4");
    expect(ix.byId(s)).toMatchObject({ type: "step", kind: "step" });
    expect(ix.parent(s)?.id).toBe("J.contacts");
    expect(ix.children("J.contacts")).toHaveLength(8);
  });

  it("collects descendants and siblings", () => {
    expect(ix.descendants("component.AddContactDialog")).toEqual([
      "component.AddContactDialog",
      "affordance.AddContactDialog.save",
      "affordance.AddContactDialog.cancel",
    ]);
    expect(ids(ix.siblings("section.domain"))).toEqual([
      "section.ui", "section.domain", "section.authorization", "section.runtime",
    ]);
  });

  it("accepts `theory` as an alias for `claims` and tolerates missing arrays", () => {
    const b = fixtureBundle();
    const { claims, ...rest } = b.model;
    const alt = buildIndex({ ...b, model: { ...rest, theory: claims, hooks: undefined } });
    expect(alt.byId("T3")?.kind).toBe("claim");
    expect(alt.hooksFor("C.webapp.contact.save")).toEqual([]);
  });
});
