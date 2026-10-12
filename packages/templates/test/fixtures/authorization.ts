import type { PackFixture } from "./types";

export const valid = {
  node: [
    ["policy.owner", "policy", "thing.a"],
    ["section.domain", "section", "thing.a"],
    ["entity.Contact", "entity", "thing.a"],
    ["aff.save", "affordance", "thing.a"],
    ["op.save", "operation", "thing.a"],
    ["op.list", "operation", "thing.a"],
    ["op.imp", "operation", "thing.a"],
  ],
  parent: [["entity.Contact", "section.domain"], ["op.list", "section.domain"]],
  policyMode: [["policy.owner", "owner-only"]],
  link: [
    ["policy.owner", "governs", "section.domain", "declared"],
    ["policy.owner", "governs", "aff.save", "declared"],
    ["aff.save", "invokes", "op.save", "declared"],
    ["op.save", "writes", "entity.Contact", "declared"],
    ["op.list", "reads", "entity.Contact", "declared"],
    ["op.imp", "inherits", "op.save", "declared"],
    ["op.imp", "writes", "entity.Contact", "declared"],
  ],
};

export const authorization: PackFixture = {
  pack: "authorization",
  valid,
  invalid: [
    {
      name: "write with no policy", rule: "authz.ungoverned", subject: "op.bad",
      facts: { node: [["op.bad", "operation", "thing.a"]], link: [["op.bad", "writes", "entity.Contact", "declared"]] },
    },
    {
      name: "two policies, different modes", rule: "authz.policyConflict", subject: "aff.save",
      facts: { node: [["policy.public", "policy", "thing.a"]], policyMode: [["policy.public", "public"]], link: [["policy.public", "governs", "aff.save", "declared"]] },
    },
    {
      name: "ungoverned read of owner-only entity", rule: "authz.privateReadUngoverned", subject: "op.peek",
      facts: { node: [["op.peek", "operation", "thing.a"]], link: [["op.peek", "reads", "entity.Contact", "declared"]] },
    },
  ],
};
