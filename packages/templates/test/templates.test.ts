import { describe, expect, it } from "vitest";
import { parseSource } from "./engine";
import { render } from "../scripts/bundle";
import { pack, packsFor, rulePacks, templateFile, templateRefs, templates } from "../src/index";
import { files } from "../src/generated/files";

const SECTIONS = ["section.ui", "section.domain", "section.authorization", "section.runtime"];
const thingRef = "template.thing.cloudflare-worker-webapp@1";
const vueRef = "template.thing.vue-webapp@1";
const systemRef = "template.system.social-networking.cloudflare@1";

describe("templates", () => {
  it("bundles three templates", () => {
    expect(templateRefs().sort()).toEqual([thingRef, systemRef, vueRef].sort());
  });

  it.each([thingRef, vueRef, systemRef])("%s parses with the Template schema", (ref) => {
    const t = templates.get(ref);
    expect(t).toBeDefined();
    expect(`${t!.id}@${t!.version}`).toBe(ref);
  });

  it("returns undefined for unknown refs and caches known ones", () => {
    expect(templates.get("template.thing.nope@1")).toBeUndefined();
    expect(templates.get("garbage")).toBeUndefined();
    expect(templates.get(thingRef)).toBe(templates.get(thingRef));
  });

  it("system template has its four sections and requires thing templates", () => {
    const t = templates.get(systemRef)!;
    expect(t.kind).toBe("system");
    expect(t.sections).toEqual(["section.purpose", "section.externals", "section.theory", "section.description"]);
    expect(t.requires).toEqual(["template.thing.*"]);
    expect(t.description).toMatch(/private-relationships/);
    expect(t.nodes.filter((n) => n.kind === "section").map((n) => n.id)).toEqual(t.sections);
  });

  describe.each([thingRef, vueRef])("%s", (ref) => {
    const t = () => templates.get(ref)!;
    it("declares the four section nodes with the $thing placeholder", () => {
      expect(t().sections).toEqual(SECTIONS);
      for (const id of SECTIONS) {
        const n = t().nodes.find((x) => x.id === id);
        expect(n?.kind).toBe("section");
        expect(n?.parent).toBe("$thing");
        expect(n?.owningThing).toBe("$thing");
      }
    });
    it("only top-level nodes use the placeholder; others have in-template parents", () => {
      const ids = new Set(t().nodes.map((n) => n.id));
      for (const n of t().nodes) {
        if (SECTIONS.includes(n.id)) continue;
        expect(n.parent === "$thing" || ids.has(n.parent!)).toBe(true);
        expect(n.owningThing).toBe("$thing");
      }
    });
    it("provides worker and d1 bindings and base criteria", () => {
      const ids = t().nodes.map((n) => n.id);
      expect(ids).toEqual(expect.arrayContaining(["binding.worker", "binding.d1"]));
      expect(t().criteria.map((c) => c.id)).toEqual(["C.webapp.exists", "C.webapp.health", "C.$thing.checks"]);
    });
  });

  it("worker template carries the shared UI, scheduler and provisional authentication nodes", () => {
    const t = templates.get(thingRef)!;
    const ids = t.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([
      "binding.scheduler", "component.AppShell", "component.TopBar", "component.PrimaryNav",
      "component.RouteOutlet", "component.StatePanel", "component.ErrorSummary", "policy.authentication",
    ]));
    expect(t.nodes.find((n) => n.id === "policy.authentication")?.provisional).toBe(true);
  });

  it("worker template hooks and scaffold match the brief", () => {
    const t = templates.get(thingRef)!;
    const exists = t.hooks.find((h) => h.id === "hook.webapp.exists")!;
    expect(exists).toMatchObject({ engine: "manifest", tier: "basic", binding: "bound", criteria: ["C.webapp.exists"] });
    expect(exists.inputs.requiredFiles).toBe("wrangler.jsonc,src/index.ts,package.json");
    const health = t.hooks.find((h) => h.id === "hook.webapp.health")!;
    expect(health).toMatchObject({ engine: "http", tier: "execution", binding: "defined", timeoutMs: 2000 });
    expect(health.inputs.path).toBe("/health");
    expect(t.criteria.find((c) => c.id === "C.webapp.exists")!.hooks).toEqual(["hook.webapp.exists"]);
    expect(t.scaffold).toEqual({ repo: "platform", path: "templates/thing/cloudflare-worker-webapp@1/scaffold" });
    expect(templateFile(thingRef, "scaffold.yaml")).toMatch(/commands:\n {2}install:/);
  });

  it("vue template names Vue in its UI defaults and keeps the same criterion ids", () => {
    const t = templates.get(vueRef)!;
    expect(t.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["component.App", "component.Router"]));
    expect(t.nodes.find((n) => n.id === "component.Router")?.description).toMatch(/vue/i);
    expect(t.criteria.map((c) => c.id)).toEqual(templates.get(thingRef)!.criteria.map((c) => c.id));
  });
});

describe("rule packs", () => {
  it("bundles the six packs at version 1", () => {
    expect(rulePacks.map((p) => `${p.id}@${p.version}`).sort()).toEqual([
      "authorization@1", "journeys@1", "metamodel@1", "readiness@1", "theory@1", "topology.private-pairs@1",
    ]);
  });

  it.each(rulePacks.map((p) => [`${p.id}@${p.version}`, p] as const))("%s parses", (_n, p) => {
    expect(() => parseSource(p.source, p.id)).not.toThrow();
  });

  it("every violation/missing/warning rule id has a .message", () => {
    for (const p of rulePacks) {
      const messages = new Set([...p.source.matchAll(/^\.message "([^"]+)"/gm)].map((m) => m[1]));
      const heads = [...p.source.matchAll(/^(?:violation|missing|warning|semanticCandidate)\("([^"]+)"/gm)].map((m) => m[1]);
      expect(heads.length).toBeGreaterThan(0);
      expect(heads.filter((h) => !messages.has(h))).toEqual([]);
    }
  });

  it("packsFor returns only the requested packs", () => {
    expect(packsFor([{ id: "readiness", version: "1" }]).map((p) => `${p.id}@${p.version}`)).toEqual(["readiness@1"]);
    expect(pack("metamodel").version).toBe("1");
  });

  it("pack() resolves the highest version, comparing numerically", () => {
    expect(pack("readiness").version).toBe("1");
  });

  it("packsFor and pack throw on unknown packs", () => {
    expect(() => packsFor([{ id: "nope", version: "1" }])).toThrow(/unknown rule pack nope@1/);
    expect(() => packsFor([{ id: "readiness", version: "9" }])).toThrow();
    expect(() => pack("nope")).toThrow();
  });

});

describe("generated bundle", () => {
  it("src/generated/files.ts is up to date with the template and pack files", async () => {
    const { readFileSync } = await import("node:fs");
    const committed = readFileSync(new URL("../src/generated/files.ts", import.meta.url), "utf8");
    expect(render()).toBe(committed);
  });

  it("holds every template file and rule pack", () => {
    expect(Object.keys(files).sort()).toEqual([
      "rule-packs/authorization@1.dl",
      "rule-packs/journeys@1.dl",
      "rule-packs/metamodel@1.dl",
      "rule-packs/readiness@1.dl",
      "rule-packs/theory@1.dl",
      "rule-packs/topology.private-pairs@1.dl",
      "system/dev-platform.cloudflare@1/template.yaml",
      "system/social-networking.cloudflare@1/template.v1.yaml",
      "system/social-networking.cloudflare@1/template.yaml",
      "thing/cli@1/template.yaml",
      "thing/cloudflare-worker-service@1/template.yaml",
      "thing/cloudflare-worker-webapp@1/criteria.yaml",
      "thing/cloudflare-worker-webapp@1/scaffold.yaml",
      "thing/cloudflare-worker-webapp@1/template.v1.yaml",
      "thing/cloudflare-worker-webapp@1/template.yaml",
      "thing/static-site@1/template.yaml",
      "thing/ts-library@1/template.yaml",
      "thing/vue-webapp@1/template.v1.yaml",
      "thing/vue-webapp@1/template.yaml",
    ]);
  });
});
