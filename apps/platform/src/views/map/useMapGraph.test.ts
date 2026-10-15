import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex } from "@/model/index";
import { resolveKindView } from "@artyfact/ontology";
import { kindViews, type KindViews } from "@/model/kinds";
import { modelKinds } from "./MapView";
import { buildMapGraph, certaintyStroke, DEFAULT_FILTERS, ENVIRONMENT_SCOPE, findingSubjectIds, mapLocationFor, mapScopeFor } from "./useMapGraph";

const index = buildIndex(fixtureBundle());
const ids = (g: ReturnType<typeof buildMapGraph>, role?: string) =>
  g.nodes.filter((n) => !role || n.role === role).map((n) => n.id).sort();
/** Views of a template chain that declares no Map layers: every kind is drawn, bands by depth. */
const unlayered: KindViews = { of: (k) => resolveKindView({ kinds: {} }, k), declares: () => true, layers: [] };

describe("buildMapGraph", () => {
  it("for screen.people: children + linked ops/entities/policies + touching externals", () => {
    const g = buildMapGraph(index, "screen.people");
    expect(ids(g, "scope")).toEqual(["screen.people"]);
    expect(ids(g, "child")).toEqual(
      ["component.AddContact", "component.AddContactDialog", "component.ContactCollection", "component.PeopleHeading", "component.SearchInput"].sort(),
    );
    expect(ids(g, "outside")).toEqual(["component.PrimaryNav", "entity.ContactRecord", "operation.contact.save", "policy.ownerOnly"]);
    expect(ids(g, "external")).toEqual(["ext.owner"]);
    for (const n of g.nodes.filter((x) => x.role === "child")) expect(n.parentId).toBe("screen.people");
    expect(g.nodes.find((n) => n.id === "component.AddContactDialog")?.childCount).toBe(4);
  });

  it("lifts descendant links to the visible child and aggregates them", () => {
    const g = buildMapGraph(index, "screen.people");
    const reads = g.edges.find((e) => e.source === "component.ContactCollection" && e.target === "entity.ContactRecord");
    expect(reads).toMatchObject({ type: "reads", certainty: "declared", stroke: "solid", count: 2 });
    expect(g.edges.find((e) => e.source === "component.AddContactDialog")).toMatchObject({ type: "invokes", target: "operation.contact.save" });
    expect(g.edges.find((e) => e.source === "policy.ownerOnly" && e.target === "screen.people")?.type).toBe("governs");
    expect(g.edges.find((e) => e.target === "ext.owner")?.type).toBe("serves");
    // links among visible outside nodes give context; containment is never an edge
    expect(g.edges.some((e) => e.source === "operation.contact.save" && e.target === "entity.ContactRecord")).toBe(true);
    expect(g.edges.some((e) => (e.type as string) === "contains")).toBe(false);
  });

  it("System scope preserves immediate containment even for kinds outside template layers", () => {
    const g = buildMapGraph(index, "system.peopling");
    const children = ids(g, "child");
    expect(children).toContain("thing.webapp");
    expect(children).not.toContain("screen.people");
    expect(children).not.toContain("entity.ContactRecord");
    expect(ids(g, "outside")).toEqual([]);
    expect(ids(g, "external")).toEqual(["ext.channels", "ext.owner", "ext.providers"]);
    expect(g.edges.some((e) => e.source === "thing.webapp" && e.target === "ext.owner")).toBe(true);
  });

  it("System scope without template layers shows its direct children (things, sections)", () => {
    const g = buildMapGraph(index, "system.peopling", DEFAULT_FILTERS, new Set(), unlayered);
    expect(ids(g, "child")).toContain("thing.webapp");
    expect(g.edges.find((e) => e.source === "thing.webapp" && e.target === "ext.owner")?.count).toBeGreaterThan(1);
  });

  it("applies filters: link types, kinds, externals, findings-only", () => {
    const noReads = buildMapGraph(index, "screen.people", { ...DEFAULT_FILTERS, hiddenLinks: ["reads"] });
    expect(ids(noReads, "outside")).not.toContain("entity.ContactRecord");
    const noPolicies = buildMapGraph(index, "screen.people", { ...DEFAULT_FILTERS, hiddenKinds: ["policy"] });
    expect(ids(noPolicies)).not.toContain("policy.ownerOnly");
    const noExt = buildMapGraph(index, "screen.people", { ...DEFAULT_FILTERS, showExternals: false });
    expect(ids(noExt, "external")).toEqual([]);
    expect(noExt.edges.some((e) => e.target === "ext.owner")).toBe(false);
    const findings = buildMapGraph(index, "screen.people", { ...DEFAULT_FILTERS, findingsOnly: true }, new Set(["component.ContactRow"]));
    expect(ids(findings, "child")).toEqual(["component.ContactCollection"]);
    expect(ids(findings, "scope")).toEqual(["screen.people"]);
  });

  it("maps certainty to stroke", () => {
    expect(certaintyStroke("declared")).toBe("solid");
    expect(certaintyStroke("assumed")).toBe("dashed");
    expect(certaintyStroke("hypothesis")).toBe("dashed");
    expect(certaintyStroke("proposed")).toBe("dotted");
  });

  it("aggregated edges take the least certain stroke", () => {
    const m = structuredClone(fixtureBundle().model);
    const row = m.nodes.find((n) => n.id === "component.ContactRow")!;
    row.links = row.links.map((l) => ({ ...l, certainty: "proposed" as const }));
    const g = buildMapGraph(buildIndex(m), "screen.people");
    const e = g.edges.find((x) => x.source === "component.ContactCollection" && x.target === "entity.ContactRecord");
    expect(e).toMatchObject({ certainty: "proposed", stroke: "dotted", count: 2 });
  });
});

describe("buildMapGraph edge cases", () => {
  it("falls back to the System for an unknown scope id", () => {
    const g = buildMapGraph(index, "nope.missing");
    expect(g.scope).toBe("system.peopling");
    expect(g.nodes.find((n) => n.role === "scope")?.id).toBe("system.peopling");
  });

  it("ignores links to ids that are not in the model", () => {
    const m = structuredClone(fixtureBundle().model);
    m.nodes.find((n) => n.id === "component.SearchInput")!.links.push({ rel: "reads", to: "entity.Missing", direction: "out", certainty: "declared" });
    const g = buildMapGraph(buildIndex(m), "screen.people");
    expect(g.ids.has("entity.Missing")).toBe(false);
    expect(g.edges.some((e) => e.target === "entity.Missing" || e.source === "component.SearchInput")).toBe(false);
  });

  it("keeps direction-in links whose normalised source is a thing", () => {
    const m = structuredClone(fixtureBundle().model);
    m.nodes.find((n) => n.id === "component.SearchInput")!.links.push({ rel: "dependsOn", to: "thing.webapp", direction: "in", certainty: "assumed" });
    expect(buildMapGraph(buildIndex(m), "screen.people").ids.has("thing.webapp")).toBe(true);
    const g = buildMapGraph(buildIndex(m), "screen.people", DEFAULT_FILTERS, new Set(), unlayered);
    expect(g.nodes.find((n) => n.id === "thing.webapp")?.role).toBe("outside");
    expect(g.edges.find((e) => e.source === "thing.webapp" && e.target === "component.SearchInput")).toMatchObject({ type: "dependsOn", stroke: "dashed" });
  });
});

describe("mapLocationFor", () => {
  it("places spatial objects, criteria and steps; other objects have no place", () => {
    expect(mapLocationFor(index, "screen.people")).toBe("screen.people");
    expect(mapLocationFor(index, "ext.owner")).toBe("ext.owner");
    expect(mapLocationFor(index, "C.webapp.contact.storage")).toBe("entity.ContactRecord");
    expect(mapLocationFor(index, "S.webapp.scope")).toBeNull();
    expect(mapLocationFor(index, "nope")).toBeNull();
    const step = index.entries.find((e) => e.type === "step" && (e.item as { screen?: string }).screen);
    if (step) expect(mapLocationFor(index, step.id)).toBe((step.item as { screen: string }).screen);
  });
});

describe("mapScopeFor", () => {
  it("containers scope to themselves, leaves and others to their container or the System", () => {
    expect(mapScopeFor(index, "screen.people")).toBe("screen.people");
    expect(mapScopeFor(index, "component.PeopleHeading")).toBe("screen.people");
    expect(mapScopeFor(index, "ext.owner")).toBe("system.peopling");
    expect(mapScopeFor(index, "nope")).toBe("system.peopling");
    const crit = index.entries.find((e) => e.type === "criterion" && (e.item as { subjectId: string }).subjectId === "screen.people");
    if (crit) expect(mapScopeFor(index, crit.id)).toBe("screen.people");
  });
});

describe("findingSubjectIds", () => {
  it("resolves criterion subjects to their nodes", () => {
    const crit = index.entries.find((e) => e.type === "criterion")!;
    const s = findingSubjectIds(index, [{ subject: crit.id }]);
    expect(s.has((crit.item as { subjectId: string }).subjectId)).toBe(true);
  });
});

describe("Map bands", () => {
  it("bands children by template layer, in template order, and hides hidden layers", () => {
    const g = buildMapGraph(index, "screen.people");
    expect(g.layered).toBe(true);
    expect(g.bands).toEqual([{ id: "experience", label: "Experience" }]);
    expect(g.nodes.find((n) => n.id === "component.SearchInput")?.band).toBe("experience");
    const hidden = buildMapGraph(index, "screen.people", { ...DEFAULT_FILTERS, hiddenLayers: ["experience"] });
    expect(ids(hidden, "child")).toEqual([]);
    expect(hidden.bands).toEqual([]);
    // Unlayered containers stay navigable rather than being flattened into their descendants.
    expect(ids(buildMapGraph(index, "system.peopling"), "child")).toContain("thing.webapp");
  });

  it("without template layers bands by containment depth", () => {
    const g = buildMapGraph(index, "screen.people", DEFAULT_FILTERS, new Set(), unlayered);
    expect(g.layered).toBe(false);
    expect(g.bands).toEqual([{ id: "depth-5", label: "Depth 5" }]);
  });
});

describe("Map Kinds filter", () => {
  it("lists every navigable kind in the containment tree, including real containers", () => {
    const { kinds } = modelKinds(index, kindViews(index.model));
    for (const k of ["purpose", "claim", "journey", "step", "screen", "entity", "thing", "section"]) expect(kinds).toContain(k);
    expect(kinds).not.toContain("criterion");
    expect(modelKinds(index, unlayered).kinds).toContain("thing");
  });
});


describe("atlas graph projection", () => {
  it("includes every declared external in environment, even disconnected and filtered", () => {
    const m = structuredClone(fixtureBundle().model);
    m.externals.push({ ...m.externals[0]!, id: "ext.disconnected", name: "Disconnected observer", links: [] });
    const g = buildMapGraph(buildIndex(m), ENVIRONMENT_SCOPE, { ...DEFAULT_FILTERS, showExternals: false, hiddenKinds: ["system", "external"], findingsOnly: true });
    expect(g.scope).toBe("environment");
    expect(ids(g, "child")).toEqual(["system.peopling"]);
    expect(ids(g, "scope")).toEqual([]);
    expect(ids(g, "external")).toEqual(["ext.channels", "ext.contacts", "ext.device", "ext.disconnected", "ext.events", "ext.owner", "ext.providers", "ext.relationship-context"]);
    expect(g.nodes.find((n) => n.id === "system.peopling")?.parentId).toBeUndefined();
    expect(g.edges.find((e) => e.source === "system.peopling" && e.target === "ext.owner")?.count).toBeGreaterThan(1);
  });

  it("retains normalized original members, labels and least certainty in lifted links", () => {
    const m = structuredClone(fixtureBundle().model);
    const row = m.nodes.find((n) => n.id === "component.ContactRow")!;
    row.links = [{ rel: "reads", to: "entity.ContactRecord", direction: "out", certainty: "proposed", label: "row data" }];
    const search = m.nodes.find((n) => n.id === "component.SearchInput")!;
    search.links.push({ rel: "dependsOn", to: "thing.webapp", direction: "in", certainty: "assumed", label: "host" });
    const g = buildMapGraph(buildIndex(m), "screen.people");
    const reads = g.edges.find((e) => e.source === "component.ContactCollection" && e.target === "entity.ContactRecord")!;
    expect(reads).toMatchObject({ certainty: "proposed", count: 2 });
    expect(reads.members ?? []).toContainEqual({ from: "component.ContactRow", to: "entity.ContactRecord", rel: "reads", certainty: "proposed", label: "row data" });
    expect(reads.members).toHaveLength(reads.count);
    expect(g.edges.find((e) => e.source === "thing.webapp" && e.target === "component.SearchInput")?.members).toEqual([
      { from: "thing.webapp", to: "component.SearchInput", rel: "dependsOn", certainty: "assumed", label: "host" },
    ]);
  });

  it("has bounded direct-child previews and authored descriptions", () => {
    const m = structuredClone(fixtureBundle().model);
    m.nodes.find((n) => n.id === "component.AddContactDialog")!.description = "Collect a contact.";
    m.externals.find((e) => e.id === "ext.owner")!.modeled = "Uses the contact workspace.";
    const g = buildMapGraph(buildIndex(m), "screen.people");
    expect(g.nodes.find((n) => n.id === "ext.owner")?.description).toBe("Uses the contact workspace.");
    const dialog = g.nodes.find((n) => n.id === "component.AddContactDialog")!;
    expect(dialog.description).toBe("Collect a contact.");
    expect(dialog.preview).toHaveLength(3);
    expect(dialog.preview.every((p) => buildIndex(m).parent(p.id)?.id === dialog.id)).toBe(true);
    expect(g.nodes.find((n) => n.id === "component.SearchInput")?.preview).toEqual([]);
  });

  it("admission is one hop only and empty/unfamiliar scopes remain valid", () => {
    const m = structuredClone(fixtureBundle().model);
    const original = m.nodes.find((n) => n.id === "component.PeopleHeading")!;
    m.nodes.push({ ...original, id: "node.unknown", kind: "unfamiliar", parent: "component.SearchInput", links: [] });
    m.nodes.push({ ...original, id: "node.twoHops", parent: "thing.webapp", links: [] });
    m.nodes.find((n) => n.id === "operation.contact.save")!.links.push({ rel: "dependsOn", to: "node.twoHops", direction: "out", certainty: "declared" });
    const i = buildIndex(m);
    expect(buildMapGraph(i, "screen.people").ids.has("node.twoHops")).toBe(false);
    expect(ids(buildMapGraph(i, "component.SearchInput"), "child")).toEqual(["node.unknown"]);
    expect(ids(buildMapGraph(i, "node.unknown"))).toEqual(["node.unknown"]);
  });
});
