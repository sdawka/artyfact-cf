import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSystem, validate } from "@artyfact/model";
import { packsFor, templates } from "@artyfact/templates";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function readTree(dir: string, out = new Map<string, string>()) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "test") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) readTree(p, out);
    else if (/\.ya?ml$/.test(name)) out.set(relative(root, p), readFileSync(p, "utf8"));
  }
  return out;
}

const files = readTree(root);
const m = loadSystem(files, { templates });
const count = (kind: string, pred: (n: (typeof m.nodes)[number]) => boolean = () => true) =>
  m.nodes.filter((n) => n.kind === kind && pred(n)).length;

describe("keep-in-touch Genome (system, purpose, externals, theory, description, kits, thing, spec, ontology)", () => {
  it("loads the System and its single Thing", () => {
    expect(m.system.id).toBe("system.keep-in-touch");
    expect(m.system.phase).toBe("unrealized");
    expect(m.things.map((t) => t.id)).toEqual(["thing.webapp"]);
    expect(m.things[0]!.sections).toEqual(["section.ui", "section.domain", "section.authorization", "section.runtime"]);
    expect(m.purposes.map((p) => p.id)).toEqual(["P1"]);
  });

  it("has the documented counts", () => {
    expect(count("screen")).toBe(8);
    expect(m.externals).toHaveLength(7);
    expect(m.claims).toHaveLength(5);
    expect(m.requirements).toHaveLength(8);
    expect(count("component")).toBeGreaterThanOrEqual(35);
    expect(count("affordance")).toBeGreaterThanOrEqual(12);
    expect(count("entity", (n) => !n.provisional)).toBe(9);
    expect(count("entity", (n) => n.provisional)).toBe(4);
    expect(count("operation")).toBe(8);
    expect(count("policy")).toBe(4);
    expect(m.description?.features.map((f) => f.id)).toEqual(["GD.contacts", "GD.goals", "GD.connect", "GD.prompts", "GD.updates"]);
  });

  it("marks the deferred and provisional items", () => {
    expect(m.claims.find((c) => c.id === "T5")?.deferred).toBe(true);
    expect(m.claims.filter((c) => c.deferred)).toHaveLength(1);
    expect(m.description?.features.find((f) => f.id === "GD.updates")?.deferred).toBe(true);
    expect(m.index.byId["policy.authentication"]).toBeDefined();
    expect((m.index.byId["policy.authentication"]!.item as { provisional: boolean }).provisional).toBe(true);
  });

  it("pins rule packs and requires the unpinned auth kit", () => {
    expect(m.kits.rulePacks.map((p) => `${p.id}@${p.version}`)).toEqual([
      "metamodel@1", "readiness@1", "authorization@1", "theory@1", "journeys@1", "topology.private-pairs@1",
    ]);
    const pinned = new Set(m.kits.kits.map((k) => k.id));
    expect(m.kits.required).toContain("auth");
    expect(pinned.has("auth")).toBe(false);
    for (const k of ["privacy", "consent", "topology.private-pairs", "notification-restraint", "accessibility", "cloudflare-webapp"]) {
      expect(pinned.has(k)).toBe(true);
    }
  });

  it("resolves every link target and requirement subject", () => {
    const dangling: string[] = [];
    for (const n of m.nodes) for (const l of n.links) if (!m.index.byId[l.to]) dangling.push(`${n.id} -> ${l.to}`);
    for (const e of m.externals) for (const l of e.links) if (!m.index.byId[l.to]) dangling.push(`${e.id} -> ${l.to}`);
    for (const r of m.requirements) for (const s of [...r.subjects, ...r.refines]) if (!m.index.byId[s]) dangling.push(`${r.id} -> ${s}`);
    expect(dangling).toEqual([]);
  });

  it("indexes the containment path of the AddContactDialog save affordance", () => {
    // path() runs from the System root, so the system id leads the Thing-relative chain.
    expect(m.index.path("affordance.AddContactDialog.save")).toEqual([
      "system.keep-in-touch", "thing.webapp", "section.ui", "screen.people", "component.AddContactDialog", "affordance.AddContactDialog.save",
    ]);
  });

  it("has no hard model findings from the pinned rule packs", () => {
    const r = validate(m, packsFor(m.kits.rulePacks));
    expect(r.findings.filter((f) => f.level === "error")).toEqual([]);
    // Criteria, journeys and evolutions come from a sibling slice; only the template hook and the intended auth Kit finding are expected here.
    const unexpected = r.findings.filter((f) => !["hook.unbound", "kit.unpinned", "coverage.requirement", "journey.operationUncovered", "journey.screenUncovered", "theory.outcomeUnlinked"].includes(f.rule));
    expect(unexpected).toEqual([]);
    expect(r.findings.some((f) => f.rule === "kit.unpinned" && f.subject === "auth")).toBe(true);
  });
});
