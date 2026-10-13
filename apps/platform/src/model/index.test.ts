import { describe, expect, it } from "vitest";
import { stepKey } from "@artyfact/model";
import { fixtureBundle } from "@/api/fixtures";
import type { ModelJson } from "./types";
import { buildIndex, stepId } from "./index";

const bundle = fixtureBundle();
const ix = buildIndex(bundle);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const nodeParent = (id: string) => bundle.model.nodes.find((n) => n.id === id)?.parent;

describe("buildIndex on the Peopling fixture", () => {
  it("indexes every object across kinds", () => {
    expect(ix.entries.length).toBeGreaterThan(bundle.model.nodes.length);
    expect(ix.byId("screen.people")).toMatchObject({ type: "node", kind: "screen" });
    expect(ix.byId("ext.owner")?.kind).toBe("external");
    expect(ix.byId("T1")?.kind).toBe("claim");
    expect(ix.byId("C.webapp.private.owner")?.kind).toBe("criterion");
    expect(ix.byId("J.contacts")?.kind).toBe("journey");
    expect(ix.byId("evolution.1")?.kind).toBe("evolution");
    expect(ix.byId("nope")).toBeUndefined();
  });

  it("lists children of screen.people in declared order", () => {
    const kids = ids(ix.children("screen.people"));
    expect(kids).toEqual(bundle.model.nodes.filter((n) => n.parent === "screen.people").map((n) => n.id));
    expect(kids).toContain("component.AddContactDialog");
    for (const k of kids) expect(ix.parent(k)?.id).toBe("screen.people");
    expect(ids(ix.children("system.peopling"))).toContain("thing.webapp");
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
    const path = ids(ix.path("affordance.AddContactDialog.save"));
    expect(path.slice(0, 3)).toEqual(["system.peopling", "thing.webapp", "section.ui"]);
    expect(path.slice(-3)).toEqual(["screen.people", "component.AddContactDialog", "affordance.AddContactDialog.save"]);
    for (let i = 3; i < path.length; i++) expect(nodeParent(path[i]!)).toBe(path[i - 1]);
    expect(ids(ix.path("T1"))).toEqual(["system.peopling", "T1"]); // claims, purposes, features, commitments, journeys sit under the System
    expect(ix.path("nope")).toEqual([]);
  });

  it("resolves criteria, hooks, journeys and requirements", () => {
    expect(ids(ix.criteriaFor("screen.people"))).toContain("C.webapp.screen.people");
    const owned = ix.criteriaOwnedBy("thing.webapp");
    expect(owned.length).toBeGreaterThan(0);
    for (const c of owned) expect(c.ownerId).toBe("thing.webapp");
    expect(ids(ix.hooksFor("C.webapp.contact.save"))).toContain("hook.webapp.contact.save");
    expect(ids(ix.journeysFor("screen.people"))).toContain("J.contacts");
    const reqs = ix.requirementsFor("screen.today");
    expect(reqs.length).toBeGreaterThan(0);
    for (const r of reqs) expect(r.subjects).toContain("screen.today");
  });

  it("indexes journey steps under the model's stepKey format", () => {
    const s = stepId("J.connect", "s4");
    expect(s).toBe("J.connect/s4");
    expect(s).toBe(stepKey("J.connect", "s4"));
    expect(ix.byId(s)).toMatchObject({ type: "step", kind: "step" });
    expect(ix.parent(s)?.id).toBe("J.connect");
    const journey = bundle.model.journeys.find((j) => j.id === "J.connect")!;
    expect(ix.children("J.connect")).toHaveLength(journey.steps.length);
  });

  it("collects descendants and siblings", () => {
    const d = ix.descendants("component.AddContactDialog");
    expect(d[0]).toBe("component.AddContactDialog");
    expect(d).toContain("affordance.AddContactDialog.save");
    // The webapp Thing holds its journeys beside its sections (their `parent` in the Genome tree).
    expect(ids(ix.siblings("section.domain")).filter((id) => !id.startsWith("J."))).toEqual(["section.ui", "section.domain", "section.events", "section.goals", "section.authorization", "section.runtime"]);
    expect(ix.parent("J.connect")?.id).toBe("thing.webapp");
  });

  it("puts a node whose parent is missing from the model under the System", () => {
    const journeys = bundle.model.journeys.map((j) => (j.id === "J.connect" ? { ...j, parent: "thing.gone" } : j));
    const ix2 = buildIndex({ ...bundle.model, journeys });
    expect(ix2.parent("J.connect")?.id).toBe(bundle.model.system.id);
    expect(ix2.children(bundle.model.system.id).map((e) => e.id)).toContain("J.connect");
  });

  it("takes containment from the server's parent, not the declaring file's path", () => {
    const model = { ...bundle.model, origin: { ...bundle.model.origin, "J.connect": "elsewhere/J.connect/node.yaml" } };
    expect(buildIndex(model).parent("J.connect")?.id).toBe("thing.webapp");
  });

  it("tolerates missing lists in an opaque bundle", () => {
    const { hooks: _hooks, ...rest } = bundle.model;
    const alt = buildIndex({ ...bundle, model: rest as unknown as ModelJson });
    expect(alt.byId("T3")?.kind).toBe("claim");
    expect(alt.hooksFor("C.webapp.contact.save")).toEqual([]);
  });
});
