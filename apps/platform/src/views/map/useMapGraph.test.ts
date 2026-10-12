import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex } from "@/model/index";
import { buildMapGraph, certaintyStroke, DEFAULT_FILTERS, findingSubjectIds, mapLayoutRequest, mapScopeFor } from "./useMapGraph";

const index = buildIndex(fixtureBundle());
const ids = (g: ReturnType<typeof buildMapGraph>, role?: string) =>
  g.nodes.filter((n) => !role || n.role === role).map((n) => n.id).sort();

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

  it("System scope shows things/sections and externals touched by any descendant", () => {
    const g = buildMapGraph(index, "system.keep-in-touch");
    expect(ids(g, "child")).toContain("thing.webapp");
    expect(ids(g, "outside")).toEqual([]);
    expect(ids(g, "external")).toEqual(["ext.channels", "ext.owner", "ext.providers"]);
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

describe("mapScopeFor", () => {
  it("containers scope to themselves, leaves and others to their container or the System", () => {
    expect(mapScopeFor(index, "screen.people")).toBe("screen.people");
    expect(mapScopeFor(index, "component.PeopleHeading")).toBe("screen.people");
    expect(mapScopeFor(index, "ext.owner")).toBe("system.keep-in-touch");
    expect(mapScopeFor(index, "nope")).toBe("system.keep-in-touch");
    const crit = index.entries.find((e) => e.type === "criterion" && (e.item as { subjectId: string }).subjectId === "screen.people");
    if (crit) expect(mapScopeFor(index, crit.id)).toBe("screen.people");
  });
});

describe("findingSubjectIds", () => {
  it("resolves criterion subjects to their nodes", () => {
    const crit = index.entries.find((e) => e.type === "criterion")!;
    const s = findingSubjectIds(index, [{ rule: "x", level: "warning", subject: crit.id, message: "" }]);
    expect(s.has((crit.item as { subjectId: string }).subjectId)).toBe(true);
  });
});

describe("mapLayoutRequest", () => {
  it("nests children in the scope group and partitions externals before internals", () => {
    const g = buildMapGraph(index, "screen.people");
    const req = mapLayoutRequest(g, "genome");
    const n = (id: string) => req.nodes.find((x) => x.id === id)!;
    expect(n("component.SearchInput").parentId).toBe("screen.people");
    expect(n("ext.owner").layoutOptions?.["elk.partitioning.partition"]).toBe("0");
    expect(n("screen.people").layoutOptions?.["elk.partitioning.partition"]).toBe("1");
    expect(n("entity.ContactRecord").layoutOptions?.["elk.partitioning.partition"]).toBe("1");
    expect(req.nodes.indexOf(n("screen.people"))).toBeLessThan(req.nodes.indexOf(n("component.SearchInput")));
    expect(mapLayoutRequest(g, "phenome").nodes.find((x) => x.id === "component.SearchInput")!.height).toBeGreaterThan(n("component.SearchInput").height);
  });
});
