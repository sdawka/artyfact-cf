import type { Graph } from "../src/index.ts";
import type { DerivationTree } from "@artyfact/rules";

export const BOARD_RULES = `
% board@1 - template pack for the fixture.
.decl node(Id: sym, Kind: sym, Parent: sym)
.decl field(Node: sym, Field: sym, Value: sym)
.decl prioritized(Card: sym)
.decl warning(Rule: sym, Subject: sym) .output
.decl semanticCandidate(Rule: sym, Subject: sym, Text: sym) .output
.message "card.unprioritized" "Card {1} has no priority."
.message "card.vague" "Card {1} may be too vague to act on."
prioritized(C) :- field(C,"priority",_).
warning("card.unprioritized",C) :- node(C,"card",_), not prioritized(C).
semanticCandidate("card.vague",C,T) :- node(C,"card",_), field(C,"title",T), contains(T,"stuff").
`;

export const base = () => ({
  id: "template.test.base",
  version: 1,
  meta: 1,
  kinds: {
    person: { fields: [{ name: "email", type: "string" }, { name: "handle", type: "string" }] },
  },
  constraints: {
    exactlyOne: [{ id: "person.contact", kind: "person", of: [{ field: "email" }, { field: "handle" }] }],
  },
});

export const board = () => ({
  id: "template.test.board",
  version: 1,
  meta: 1,
  extends: "template.test.base@1",
  kinds: {
    board: {
      fields: [
        { name: "title", type: "string", required: true },
        { name: "status", type: "string", enum: ["draft", "live"] },
        { name: "owner", type: "ref" },
      ],
      completeness: { children: [{ kind: "card", cardinality: "1..5" }] },
    },
    card: {
      parents: ["board"],
      fields: [
        { name: "title", type: "string", required: true },
        { name: "priority", type: "number" },
        { name: "state", type: "string", enum: ["open", "done"] },
        { name: "archived", type: "boolean" },
      ],
      completeness: { relations: [{ rel: "assignedTo", cardinality: "1" }] },
    },
  },
  relations: {
    assignedTo: { from: ["card"], to: ["person"], cardinality: { out: "0..1", in: "1..*" } },
    blocks: { from: ["card"], to: ["card"], cardinality: { in: "0..2" } },
    dependsOn: { from: ["card"], to: ["card"], acyclic: true },
  },
  constraints: {
    forbiddenCycles: [{ id: "no-blocking-loop", relations: ["blocks"] }],
    incompatible: [{ id: "archived-open", kind: "card", when: [{ field: "archived", value: true }, { field: "state", value: "open" }] }],
    exclusive: [{ id: "blocks-or-depends", relations: ["blocks", "dependsOn"] }],
    complete: [{ id: "boards-complete", kind: "board" }],
  },
  criteria: [{ id: "crit.card-titled", owner: "product", subject: "card", severity: "hard", hooks: ["hook.title"] }],
  rules: [{ id: "board", version: "1", source: BOARD_RULES }],
  questions: [{
    id: "card.vague", answer: "yes-no", slice: { fields: ["title"] }, benign: "no",
    policy: [{ answer: "yes", level: "warning" }],
  }],
  nodes: [{ id: "$self.inbox", kind: "card", parent: "$self", fields: { title: "Inbox for $self" } }],
});

export const clean = (): Graph => ({
  template: "template.test.board@1",
  nodes: [
    { id: "b1", kind: "board", fields: { title: "Launch", status: "live", owner: "p1" } },
    { id: "c1", kind: "card", parent: "b1", fields: { title: "Write copy", priority: 1, state: "open" } },
    { id: "c2", kind: "card", parent: "b1", fields: { title: "Ship", priority: 2, state: "done", archived: true } },
    { id: "p1", kind: "person", fields: { email: "a@example.com" } },
  ],
  links: [
    { from: "c1", rel: "assignedTo", to: "p1" },
    { from: "c2", rel: "assignedTo", to: "p1" },
    { from: "c1", rel: "blocks", to: "c2" },
  ],
  declarations: [{ scope: "b1", status: "complete" }],
  evidence: [{ id: "e1", subject: "c2", kind: "screenshot" }],
});

/** Every leaf of the tree is an EDB fact. */
export function edbLeaves(t: DerivationTree): boolean {
  if (!t.children.length) return t.edb;
  return t.children.every(edbLeaves);
}
