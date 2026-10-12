import { merge } from "../engine";
import type { PackFixture } from "./types";

const ids = ["system.k", "thing.a", "section.ui", "op.x", "C.1"];

export const valid = {
  known: ids.map((i) => [i]),
  system: [["system.k"]],
  thing: [["thing.a", ""]],
  node: [["section.ui", "section", "thing.a"], ["op.x", "operation", "thing.a"]],
  parent: [["section.ui", "thing.a"], ["op.x", "section.ui"]],
  ref: [["op.x", "governs", "section.ui"]],
  criterion: [["C.1", "thing", "thing.a", "op.x", "hard"]],
  thingArtifact: [["thing.a", "artifact.app"]],
  thingSection: [["thing.a", "section.ui"]],
};

const add = (f: Record<string, (string | number)[][]>) => merge(f);

export const metamodel: PackFixture = {
  pack: "metamodel",
  valid,
  invalid: [
    { name: "dangling ref", rule: "ref.dangling", subject: "op.x", facts: add({ ref: [["op.x", "reads", "nope"]] }) },
    { name: "missing parent", rule: "ref.parentMissing", subject: "op.y", facts: add({ known: [["op.y"]], parent: [["op.y", "ghost"]] }) },
    { name: "containment cycle", rule: "tree.cycle", subject: "section.ui", facts: add({ parent: [["section.ui", "op.x"]] }) },
    { name: "two parents", rule: "tree.multiParent", subject: "op.x", facts: add({ parent: [["op.x", "thing.a"]] }) },
    { name: "unknown owner", rule: "owner.unknown", subject: "n.z", facts: add({ known: [["n.z"]], node: [["n.z", "component", "thing.ghost"]] }) },
    { name: "criterion subject missing", rule: "criterion.subjectMissing", subject: "C.2", facts: add({ known: [["C.2"]], criterion: [["C.2", "thing", "thing.a", "ghost", "hard"]] }) },
    { name: "criterion thing owner missing", rule: "criterion.ownerMissing", subject: "C.3", facts: add({ known: [["C.3"]], criterion: [["C.3", "thing", "thing.ghost", "op.x", "hard"]] }) },
    { name: "criterion system owner missing", rule: "criterion.ownerMissing", subject: "C.4", facts: add({ known: [["C.4"]], criterion: [["C.4", "system", "system.ghost", "op.x", "hard"]] }) },
    { name: "thing without artifact", rule: "thing.noArtifact", subject: "thing.b", facts: add({ known: [["thing.b"]], thing: [["thing.b", ""]] }) },
    { name: "thing section missing", rule: "thing.sectionMissing", subject: "thing.a", facts: add({ thingSection: [["thing.a", "section.ghost"]] }) },
  ],
};
