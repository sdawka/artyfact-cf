import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkTemplateForm, checkViewHints, evaluate, instantiateNodes, loadTemplate, resolveKindView, type Graph, type Template,
} from "@artyfact/ontology";
import { metaTemplateRefs, metaTemplateSource, templateRefs, templates } from "../src/index";
import { COMPOSED, compose, GENERIC_THINGS, readGenome, SYSTEM } from "./dev-platform";

const ALL = [SYSTEM, ...GENERIC_THINGS];
const load = (ref: string) => loadTemplate(metaTemplateSource(ref));
const genomeDir = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures/dev-platform/genome");

describe("generic templates", () => {
  it("bundles the five meta@1 templates beside the v1 ones", () => {
    expect(metaTemplateRefs().sort()).toEqual([...ALL].sort());
    expect(templateRefs().every((r) => !ALL.includes(r))).toBe(true);
    for (const ref of ALL) expect(templates.get(ref)).toBeUndefined();
  });

  describe.each(ALL)("%s", (ref) => {
    const t = (): Template => load(ref);

    it("passes checkTemplateForm and the view hints", () => {
      const form = checkTemplateForm(t());
      expect(form.findings).toEqual([]);
      expect(form.valid).toBe(true);
      expect(checkViewHints(t())).toEqual([]);
    });

    it("gives every kind a view with a glyph, a colour and a field order", () => {
      for (const k of Object.keys(t().kinds)) {
        const v = resolveKindView(t(), k);
        expect(t().kinds[k]!.view, k).toBeDefined();
        expect(v.glyph, k).not.toBe("•");
        expect(v.fields.length, k).toBeGreaterThan(0);
      }
    });

    it("declares every kind it names as a parent, and every layer it uses", () => {
      const layers = new Set((t().view?.layers ?? []).map((l) => l.id));
      for (const [k, kind] of Object.entries(t().kinds)) {
        for (const p of kind.parents ?? []) expect(t().kinds[p], `${k} parent ${p}`).toBeDefined();
        if (kind.view?.layer) expect(layers.has(kind.view.layer), `${k} layer`).toBe(true);
      }
    });
  });

  describe.each(GENERIC_THINGS)("%s", (ref) => {
    const t = (): Template => load(ref);
    it("has sections and the five-relation vocabulary it can use", () => {
      expect(t().nodes.every((n) => n.kind === "section" && n.parent === "$self")).toBe(true);
      expect(t().nodes.length).toBeGreaterThanOrEqual(2);
      expect(Object.keys(t().relations)).toEqual(expect.arrayContaining(["dependsOn", "exposes", "calls", "deploys"]));
    });

    it("has root file defaults, node or kind file defaults, and 2 to 3 kind-wide checks per surface kind", () => {
      expect((t().files ?? []).join(" ")).toMatch(/package\.json/);
      expect((t().files ?? []).some((g) => g.startsWith("test/"))).toBe(true);
      expect([...Object.values(t().kinds), ...t().nodes].some((k) => (k.files ?? []).length > 0)).toBe(true);
      const withChecks = Object.entries(t().kinds).filter(([k, kind]) => !["system", "thing", "section"].includes(k) && kind.checks?.length);
      expect(withChecks.length).toBeGreaterThanOrEqual(2);
      const total = withChecks.reduce((n, [, kind]) => n + kind.checks!.length, 0);
      expect(total).toBeGreaterThanOrEqual(3);
    });

    it("has criteria wording for each of its own kinds", () => {
      for (const [k, kind] of Object.entries(t().kinds)) expect(kind.criteria, k).toBeDefined();
    });
  });

  it("each Thing template names its documented kinds and sections", () => {
    const shape = (ref: string) => ({
      kinds: Object.keys(load(ref).kinds).filter((k) => !["system", "thing", "section"].includes(k)).sort(),
      sections: load(ref).nodes.map((n) => n.id).sort(),
    });
    expect(shape("template.thing.cloudflare-worker-service@1")).toEqual({
      kinds: ["binding", "durable-object", "endpoint", "module", "queue", "workflow"],
      sections: ["$self.api", "$self.modules", "$self.runtime", "$self.state"],
    });
    expect(shape("template.thing.ts-library@1")).toEqual({ kinds: ["export", "module"], sections: ["$self.api", "$self.modules"] });
    expect(shape("template.thing.cli@1")).toEqual({ kinds: ["command", "module", "option"], sections: ["$self.commands", "$self.modules"] });
    expect(shape("template.thing.static-site@1")).toEqual({ kinds: ["asset", "page"], sections: ["$self.build", "$self.pages"] });
  });

  it("the System template has purpose, theory and description sections and no externals", () => {
    const t = load(SYSTEM);
    expect(t.nodes.map((n) => n.id).sort()).toEqual(["$self.description", "$self.purpose", "$self.theory"]);
    expect(Object.keys(t.kinds)).not.toContain("external");
    expect(t.rules.map((r) => `${r.id}@${r.version}`)).toEqual(["topology.services@1"]);
  });

  it("instantiates a Thing's sections under the Thing id", () => {
    expect(instantiateNodes(load("template.thing.cli@1"), "thing.cli").map((n) => [n.id, n.parent])).toEqual([
      ["thing.cli.commands", "thing.cli"], ["thing.cli.modules", "thing.cli"],
    ]);
  });

  it("keeps shared kinds identical across templates", () => {
    // compose() throws when two templates declare one kind differently.
    expect(() => compose(ALL)).not.toThrow();
  });
});

describe("the dev-platform fixture Genome", () => {
  const composed = () => loadTemplate(compose(ALL));
  const { graph, nodes } = readGenome(genomeDir);
  const run = (g: Graph) => evaluate(composed(), g);
  const rule = (g: Graph, id: string) => run(g).findings.filter((f) => f.rule === id);

  it("composes into a form-valid template", () => {
    const form = checkTemplateForm(composed());
    expect(form.findings).toEqual([]);
    expect(composed().ref).toBe(COMPOSED);
  });

  it("loads as a tree: one System root, four Things, every node under its enclosing directory", () => {
    expect(graph.nodes.filter((n) => n.parent === undefined && n.kind !== "template").map((n) => n.id)).toEqual(["system.toolkit"]);
    expect(graph.nodes.filter((n) => n.kind === "thing").length).toBe(4);
    expect(graph.nodes.find((n) => n.id === "endpoint.health")?.parent).toBe("thing.api.api");
    expect(graph.nodes.find((n) => n.id === "option.verbose")?.parent).toBe("command.deploy");
  });

  it("prefilled sections of the fixture match what each template instantiates", () => {
    for (const [id, n] of nodes) {
      if (!n.template || n.kind !== "thing") continue;
      const want = instantiateNodes(load(n.template), id).map((s) => s.id).sort();
      const have = graph.nodes.filter((x) => x.kind === "section" && x.parent === id).map((x) => x.id).sort();
      expect(have, id).toEqual(want);
    }
  });

  it("evaluates with no hard findings", () => {
    const r = run(graph);
    expect(r.findings.filter((f) => f.level === "error" || f.level === "missing")).toEqual([]);
    expect(r.findings.filter((f) => f.level === "warning")).toEqual([]);
    expect(r.actionable).toBe(true);
    expect(r.packs.map((p) => p.id)).toEqual(expect.arrayContaining(["metamodel", "completeness", "consistency", "text", "topology.services"]));
  });

  it("flags a Thing dependsOn cycle", () => {
    const g: Graph = { ...graph, links: [...graph.links, { from: "thing.core", rel: "dependsOn", to: "thing.cli" }] };
    expect(rule(g, "topology.thingCycle").map((f) => f.subject).sort()).toEqual(["thing.cli", "thing.core"]);
    expect(run(g).actionable).toBe(false);
  });

  it("flags a cycle that runs through modules of different Things", () => {
    const g: Graph = { ...graph, links: [...graph.links, { from: "module.parser", rel: "dependsOn", to: "module.router" }] };
    expect(rule(g, "topology.thingCycle").map((f) => f.subject).sort()).toEqual(["thing.api", "thing.core"]);
  });

  it("does not flag module dependencies inside one Thing", () => {
    const g: Graph = {
      ...graph,
      nodes: [...graph.nodes, { id: "module.helpers", kind: "module", parent: "thing.api.modules", fields: { title: "Helpers", description: "Small shared functions for the router." } }],
      links: [...graph.links, { from: "module.helpers", rel: "dependsOn", to: "module.router" }, { from: "module.router", rel: "dependsOn", to: "module.helpers" }],
    };
    expect(rule(g, "topology.thingCycle")).toEqual([]);
  });

  it("flags an endpoint outside a Worker Thing", () => {
    const stray = {
      id: "endpoint.stray", kind: "endpoint", parent: "thing.cli.commands",
      fields: { title: "Stray", description: "A route declared in the CLI by mistake.", route: "GET /stray", auth: "Anonymous." },
    };
    const g: Graph = { ...graph, nodes: [...graph.nodes, stray] };
    expect(rule(g, "topology.endpointOutsideWorker").map((f) => f.subject)).toEqual(["endpoint.stray"]);
    expect(rule(graph, "topology.endpointOutsideWorker")).toEqual([]);
    expect(run(g).actionable).toBe(false);
  });

  it("warns about a library nobody depends on, and stops when someone does", () => {
    const orphan = { id: "thing.orphan", kind: "thing", parent: "system.toolkit", fields: { title: "Orphan library", description: "A library that nothing imports yet." } };
    const pinned = { from: "thing.orphan", rel: "pinned", to: "template.thing.ts-library@1" };
    const g: Graph = { ...graph, nodes: [...graph.nodes, orphan], links: [...graph.links, pinned] };
    const hit = rule(g, "topology.unusedLibrary");
    expect(hit.map((f) => [f.level, f.subject])).toEqual([["warning", "thing.orphan"]]);
    expect(run(g).actionable).toBe(true);
    const used: Graph = { ...g, links: [...g.links, { from: "thing.api", rel: "dependsOn", to: "thing.orphan" }] };
    expect(rule(used, "topology.unusedLibrary")).toEqual([]);
  });

  it("applies the deterministic checks of the kinds", () => {
    const bad = (id: string, fields: Record<string, unknown>) => ({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === id ? { ...n, fields: { ...n.fields, ...fields } } : n)),
    });
    expect(rule(bad("endpoint.health", { route: "health" }), "check:endpoint.routeShape").map((f) => f.subject)).toEqual(["endpoint.health"]);
    expect(rule(bad("option.verbose", { flag: "verbose" }), "check:option.flagShape").map((f) => f.subject)).toEqual(["option.verbose"]);
    expect(rule(bad("page.status", { route: "status" }), "check:page.routeShape").map((f) => f.subject)).toEqual(["page.status"]);
    expect(rule(bad("binding.jobs-db", { envName: "jobsDb" }), "check:binding.envNameShape").map((f) => f.level)).toEqual(["warning"]);
    expect(rule(graph, "check:endpoint.routeShape")).toEqual([]);
  });

  it("raises semantic candidates for the judged checks, e.g. an endpoint's auth principal", () => {
    const r = run(graph).findings.filter((f) => f.rule.startsWith("semantic:check:"));
    expect(r.some((f) => f.rule === "semantic:check:endpoint.authPrincipal" && f.subject === "endpoint.health")).toBe(true);
    expect(r.some((f) => f.rule === "semantic:check:command.documented" && f.subject === "command.deploy")).toBe(true);
  });
});
