import { describe, expect, it } from "vitest";
import { loadGenome, validate } from "@artyfact/model";
import type { DerivationTree } from "@artyfact/rules";
import { metaTemplates } from "../src/index";

// Real pipeline: node tree -> loadGenome -> readiness with the System template's topology pack, pinned alone.
function model(cardinality: "one" | "many", affordance = "one") {
  return new Map<string, string>([
    ["node.yaml", `id: system.mini
kind: system
template: template.system.social-networking.cloudflare@1
fields: {name: Mini, rulePacks: [{id: topology.private-pairs, version: "1"}]}
`],
    ["thing.app/node.yaml", "id: thing.app\nkind: thing\ntemplate: template.thing.cloudflare-worker-webapp@1\nfields: {name: App, description: App}\n"],
    ["thing.app/section.domain/node.yaml", "id: section.domain\nkind: section\nfields: {name: Domain}\n"],
    ["thing.app/section.domain/entity.Message/node.yaml", `id: entity.Message
kind: entity
fields:
  name: Message
  fields:
    - { name: to, type: ref:entity.Account }
    - { name: body, type: text }
`],
    ["thing.app/section.domain/entity.Account/node.yaml", "id: entity.Account\nkind: entity\nfields: {name: Account}\n"],
    ["thing.app/section.domain/operation.message.send/node.yaml", `id: operation.message.send
kind: operation
fields: {name: Send message, cardinality: ${cardinality}}
links: [{rel: writes, to: entity.Message}]
`],
    ["thing.app/section.domain/affordance.send/node.yaml", `id: affordance.send\nkind: affordance\nfields: {name: Send, cardinality: ${affordance}}\nlinks: [{rel: invokes, to: operation.message.send}]\n`],
  ]);
}

function check(cardinality: "one" | "many", affordance: "one" | "many" = "one") {
  const r = validate(loadGenome(model(cardinality, affordance), { templates: metaTemplates }));
  const violations = (r.derived.violation ?? []).filter((t) => t[0] === "topology.recipientArray");
  return { r, violations };
}

const relations = (t: DerivationTree): string[] => [t.relation, ...t.children.flatMap(relations)];
const nodes = (t: DerivationTree): DerivationTree[] => [t, ...t.children.flatMap(nodes)];

describe("outgoingDirect", () => {
  // Readiness exposes output relations only, so outgoingDirect is read from the derivations of the findings it feeds.
  it("is derived for the writing operation and the affordance that invokes it", () => {
    const outgoing = check("many", "many").r.findings
      .filter((x) => x.rule === "topology.recipientArray")
      .flatMap((f) => nodes(f.derivation).filter((n) => n.relation === "outgoingDirect").map((n) => String(n.tuple[0])));
    expect([...new Set(outgoing)].sort()).toEqual(["affordance.send", "operation.message.send"]);
  });

  it("cardinality many fires topology.recipientArray through outgoingDirect", () => {
    const { r, violations } = check("many");
    expect(violations).toEqual([["topology.recipientArray", "operation.message.send", "hard"]]);
    const f = r.findings.find((x) => x.rule === "topology.recipientArray")!;
    expect(f.pack).toBe("topology.private-pairs@1");
    expect(relations(f.derivation)).toEqual(expect.arrayContaining(["outgoingDirect", "link", "field"]));
  });

  it("cardinality one raises no violation", () => {
    expect(check("one").violations).toEqual([]);
  });
});
