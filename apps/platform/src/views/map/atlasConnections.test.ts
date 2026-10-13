import { describe, expect, it } from "vitest";
import { fixtureBundle } from "@/api/fixtures";
import { buildIndex } from "@/model/index";
import { buildMapGraph } from "./useMapGraph";
import { selectedBoundaryEdges, boundaryContextIds } from "./atlasConnections";
const index = buildIndex(fixtureBundle());
const graph = buildMapGraph(index, "screen.people");
describe("selected subtree boundary connections", () => {
  it("includes descendants crossing the selected current scope and excludes wholly internal members", () => {
    const edges = selectedBoundaryEdges(graph, "screen.people", index);
    expect(edges.some((edge) => edge.source === "component.AddContactDialog" && edge.target === "operation.contact.save")).toBe(true);
    expect(edges.some((edge) => edge.source === "component.ContactCollection" && edge.target === "entity.ContactRecord")).toBe(true);
    const inside = new Set(index.descendants("screen.people"));
    expect(edges.flatMap((edge) => edge.members).every((member) => inside.has(member.from) !== inside.has(member.to))).toBe(true);
    expect(boundaryContextIds(graph, "screen.people", index)).toContain("entity.ContactRecord");
    expect(boundaryContextIds(graph, "screen.people", index)).not.toContain("component.ContactCollection");
  });
  it("filters original members even when their projected endpoints differ", () => {
    const original = graph.edges.find((edge) => edge.source === "component.AddContactDialog")!;
    const mixed = { ...original, count: 2, members: [...original.members, { from: "affordance.AddContactDialog.save", to: "component.ContactCollection", rel: original.type, certainty: "proposed" as const }] };
    const filtered = selectedBoundaryEdges({ ...graph, edges: [mixed] }, "screen.people", index);
    expect(filtered[0]!.members).toEqual(original.members);
    expect(filtered[0]!.count).toBe(original.members.length);
  });
  it("preserves ordinary selected-tile edges and a quiet null selection", () => {
    expect(selectedBoundaryEdges(graph, "component.AddContactDialog", index).map((edge) => edge.id)).toEqual(graph.edges.filter((edge) => edge.source === "component.AddContactDialog" || edge.target === "component.AddContactDialog").map((edge) => edge.id));
    expect(selectedBoundaryEdges(graph, null, index)).toEqual([]);
  });
});
