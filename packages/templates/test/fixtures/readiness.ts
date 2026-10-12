import type { PackFixture } from "./types";

const tpl = "template.thing.t@1";

export const valid = {
  known: [["section.ui"], ["op.x"]],
  node: [["section.ui", "section", "thing.a"]],
  thing: [["thing.a", tpl]],
  templateKnown: [[tpl]],
  templateRequires: [[tpl, "section.ui"]],
  templateRequiresCriterion: [[tpl, "C.exists"]],
  requirementEnabled: [["S.1"]],
  criterion: [["C.exists", "thing", "thing.a", "thing.a", "hard"]],
  criterionSourceRef: [["C.exists", "S.1"]],
  criterionHook: [["C.exists", "H1"]],
  hook: [["H1", "bound"]],
  kitRequired: [["privacy"]],
  kitPinned: [["privacy", "1"]],
  evolution: [["E1", "actionable"], ["E0", "promoted"]],
  evolutionAcceptance: [["E1", "C.exists"]],
  evolutionAffects: [["E1", "op.x"]],
};

export const readiness: PackFixture = {
  pack: "readiness",
  valid,
  invalid: [
    { name: "requirement without criterion", rule: "coverage.requirement", subject: "S.2", relation: "missing", facts: { requirementEnabled: [["S.2"]] } },
    {
      name: "criterion without hook", rule: "coverage.hook", subject: "C.nohook", relation: "missing",
      facts: { criterion: [["C.nohook", "thing", "thing.a", "thing.a", "hard"]] },
    },
    {
      name: "deferred criterion needs no hook", rule: "coverage.hook", subject: "C.later", relation: "none",
      facts: { criterion: [["C.later", "thing", "thing.a", "thing.a", "hard"]], criterionDeferred: [["C.later"]] },
    },
    { name: "hook defined but unbound", rule: "hook.unbound", subject: "C.exists", relation: "warning", facts: { criterionHook: [["C.exists", "H2"]], hook: [["H2", "defined"]] } },
    { name: "template section removed", rule: "template.sectionMissing", subject: "thing.a", relation: "violation", facts: { templateRequires: [[tpl, "section.domain"]] } },
    { name: "template criterion removed", rule: "template.criterionMissing", subject: "thing.a", relation: "violation", facts: { templateRequiresCriterion: [[tpl, "C.health"]] } },
    { name: "unknown template", rule: "template.unknown", subject: "thing.b", relation: "violation", facts: { thing: [["thing.b", "template.thing.ghost@1"]] } },
    { name: "kit not pinned", rule: "kit.unpinned", subject: "auth", relation: "warning", facts: { kitRequired: [["auth"]] } },
    {
      name: "evolution without acceptance", rule: "evolution.acceptanceMissing", subject: "E2", relation: "missing",
      facts: { evolution: [["E2", "proposed"]], evolutionAffects: [["E2", "op.x"]] },
    },
    {
      name: "evolution affecting nothing", rule: "evolution.affectsMissing", subject: "E3", relation: "missing",
      facts: { evolution: [["E3", "proposed"]], evolutionAcceptance: [["E3", "C.exists"]] },
    },
  ],
};
