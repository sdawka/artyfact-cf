/// <reference types="vite/client" />
/** The ontology engine in workerd: Keep in Touch through the node-tree codec, evaluate, and one routed message (fake providers). */
import { describe, expect, it } from "vitest";
import {
  evaluate, fakeSystemOne, fakeTranslator, readTree, route, routeSlice, routeVocabulary, validateOps,
} from "@artyfact/ontology";
import { composeTemplate, metaTemplates } from "@artyfact/templates";

const raw = (g: Record<string, string>, root: string) =>
  Object.fromEntries(Object.entries(g).map(([p, t]) => [p.slice(p.indexOf(root) + root.length), t] as const));
const genome = raw(import.meta.glob("../../../examples/keep-in-touch-system/**/*.yaml", { query: "?raw", import: "default", eager: true }) as Record<string, string>, "keep-in-touch-system/");

describe("@artyfact/ontology in workerd", () => {
  const template = composeTemplate("template.system.social-networking.cloudflare@1", ["template.thing.cloudflare-worker-webapp@1"]);
  const graph = readTree(genome, metaTemplates);

  it("loads Keep in Touch and evaluates it", () => {
    expect(graph.nodes.some((n) => n.id === "thing.webapp" && n.kind === "thing")).toBe(true);
    const r = evaluate(template, graph);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.some((f) => f.rule === "kit.unpinned")).toBe(true);
  });

  it("routes and translates one message with the fake providers", async () => {
    const message = "Let users snooze a contact for a month";
    const r = await route(graph, template, message, fakeSystemOne());
    expect(r.order).toBe("shortlist-first");
    expect(r.path[0]?.level).toBe("shortlist");
    expect(r.target.nodes.length).toBeGreaterThan(0);
    expect(r.calls).toBeLessThanOrEqual(8);
    expect(r.provenance.provider).toBe("fake");

    const slice = routeSlice(graph, r);
    const t = await fakeTranslator().translate({ message, route: r, slice, vocabulary: routeVocabulary(template, r, slice) });
    expect(t.provider).toBe("fake");
    expect(t.ops?.length ?? 0).toBeGreaterThan(0);
    expect(validateOps(t.ops!, template, graph).filter((p) => p.level === "error")).toEqual([]);
  });
});
