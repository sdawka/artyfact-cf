import type { PackFixture } from "./types";

export const valid = {
  node: [
    ["entity.Connection", "entity", "thing.a"],
    ["op.invite", "operation", "thing.a"],
    ["ext.group", "external", ""],
  ],
  nodeName: [["entity.Connection", "connection"], ["op.invite", "invite"], ["ext.group", "group chats"]],
  entityField: [["entity.Connection", "a", "ref:entity.Account"], ["entity.Connection", "b", "ref:entity.Account"]],
  effectText: [["op.invite", "creates an invite for one person"]],
  cardinality: [["op.invite", "one"]],
  outgoingDirect: [["op.invite"]],
};

const entity = (id: string, fieldTypes: string[], extra: Record<string, string[][]> = {}) => ({
  node: [[id, "entity", "thing.a"]],
  entityField: fieldTypes.map((t, i) => [id, `f${i}`, t]),
  ...extra,
});

const connection = (id: string, refs: number) => ({
  node: [[id, "entity", "thing.a"]],
  nodeName: [[id, "connection"]],
  entityField: Array.from({ length: refs }, (_, i) => [id, `acct${i}`, "ref:entity.Account"]),
});

export const topology: PackFixture = {
  pack: "topology.private-pairs",
  valid,
  invalid: [
    { name: "recipients[] effect", rule: "topology.recipientArray", subject: "op.invite", facts: { effectText: [["op.invite", "stores recipients[] to notify"]] } },
    { name: "recipient[] field", rule: "topology.recipientArray", subject: "op.fieldy", facts: { effectText: [["op.fieldy", "field recipient[]"]] } },
    { name: "recipient list", rule: "topology.recipientArray", subject: "op.list", facts: { effectText: [["op.list", "sends to a recipient list"]] } },
    { name: "bulk send", rule: "topology.recipientArray", subject: "op.bulk", facts: { effectText: [["op.bulk", "bulk send"]] } },
    {
      name: "outgoing cardinality many", rule: "topology.recipientArray", subject: "op.fan",
      facts: { node: [["op.fan", "operation", "thing.a"]], outgoingDirect: [["op.fan"]], cardinality: [["op.fan", "many"]] },
    },
    { name: "group entity", rule: "topology.groupEnabled", subject: "entity.Group", facts: { node: [["entity.Group", "entity", "thing.a"]], nodeName: [["entity.Group", "group"]] } },
    { name: "connection with one account ref", rule: "topology.pairCardinality", subject: "entity.C1", facts: connection("entity.C1", 1) },
    { name: "connection with no account refs", rule: "topology.pairCardinality", subject: "entity.C0", facts: connection("entity.C0", 0) },
    { name: "connection with three account refs", rule: "topology.pairCardinality", subject: "entity.C3", facts: connection("entity.C3", 3) },
    { name: "list of accounts on an entity", rule: "topology.recipientArray", subject: "entity.Fanout", facts: entity("entity.Fanout", ["list<ref:entity.Account>"]) },
    {
      name: "provisional entity with account list is ignored", rule: "topology.recipientArray", subject: "entity.Draft", relation: "none",
      facts: entity("entity.Draft", ["list<ref:entity.Account>"], { provisional: [["entity.Draft"]] }),
    },
    {
      name: "mentions recipients", rule: "topology.multiRecipient", subject: "op.send", relation: "semanticCandidate",
      facts: { effectText: [["op.send", "notifies the recipient of each nudge"]] },
    },
  ],
};
