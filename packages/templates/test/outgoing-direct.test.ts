import { describe, expect, it } from "vitest";
import { loadSystem, schema, toFacts } from "@artyfact/model";
import { explain, parse, run, type DerivationTree } from "@artyfact/rules";
import { pack } from "../src/index";

// A bare Thing template keeps the fixture minimal; the nodes under test live in the instance ontology.
const bare = schema.Template.parse({ id: "template.thing.bare", kind: "thing", version: "1", name: "Bare" });
const templates = { get: (ref: string) => (ref === "template.thing.bare@1" ? bare : undefined) };

// Real pipeline: YAML file map -> loadSystem -> toFacts -> topology pack on the @artyfact/rules engine.
function model(cardinality: "one" | "many") {
  return new Map<string, string>([
    ["system.yaml", "id: system.mini\nname: Mini\ntemplate: null\nthings: [thing.app]\nphase: unrealized\npurposes: []\n"],
    ["things/app/thing.yaml", "id: thing.app\nname: App\ntemplateRef: template.thing.bare@1\ndescription: App\nartifacts: []\nsections: [section.domain]\n"],
    ["things/app/ontology.yaml", `nodes:
  - { id: section.domain, kind: section, name: Domain }
  - id: entity.Message
    kind: entity
    name: Message
    parent: section.domain
    fields:
      - { name: to, type: ref:entity.Account }
      - { name: body, type: text }
  - { id: entity.Account, kind: entity, name: Account, parent: section.domain }
  - id: operation.message.send
    kind: operation
    name: Send message
    parent: section.domain
    cardinality: ${cardinality}
    links:
      - { rel: writes, to: entity.Message }
  - id: affordance.send
    kind: affordance
    name: Send
    parent: section.domain
    links:
      - { rel: invokes, to: operation.message.send }
`],
  ]);
}

function check(cardinality: "one" | "many") {
  const facts = toFacts(loadSystem(model(cardinality), { templates }));
  const result = run(facts, [parse(pack("topology.private-pairs").source, "topology")], { all: true });
  const violations = (result.relations.get("violation") ?? []).filter((t) => t[0] === "topology.recipientArray");
  const outgoing = (result.relations.get("outgoingDirect") ?? []).map((t) => String(t[0])).sort();
  return { result, violations, outgoing };
}

const relations = (t: DerivationTree): string[] => [t.relation, ...t.children.flatMap(relations)];

describe("outgoingDirect", () => {
  it("is derived for the writing operation and the affordance that invokes it", () => {
    expect(check("one").outgoing).toEqual(["affordance.send", "operation.message.send"]);
  });

  it("cardinality many fires topology.recipientArray through outgoingDirect", () => {
    const { result, violations } = check("many");
    expect(violations).toEqual([["topology.recipientArray", "operation.message.send", "hard"]]);
    const tree = explain(result, "violation", violations[0]);
    expect(relations(tree)).toEqual(expect.arrayContaining(["outgoingDirect", "link", "accountRefField", "entityField", "cardinality"]));
  });

  it("cardinality one raises no violation", () => {
    expect(check("one").violations).toEqual([]);
  });
});
