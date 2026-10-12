import type { PackFixture } from "./types";

export const valid = {
  known: [["screen.a"], ["op.a"]],
  node: [["screen.a", "screen", "thing.a"], ["op.a", "operation", "thing.a"]],
  journey: [["J.1", "s1"], ["J.later", "s1"]],
  journeyDeferred: [["J.later"]],
  step: [["J.1", "s1"], ["J.1", "s2"], ["J.1", "s3"], ["J.later", "s1"]],
  stepNext: [["J.1", "s1", "s2"], ["J.1", "s2", "s3"]],
  stepEnd: [["J.1", "s3"]],
  stepRef: [["J.1", "s2", "screen.a"], ["J.1", "s2", "op.a"]],
  stepScreen: [["J.1", "s2", "screen.a"]],
  stepOperation: [["J.1", "s2", "op.a"]],
};

export const journeys: PackFixture = {
  pack: "journeys",
  valid,
  invalid: [
    { name: "start step missing", rule: "journey.startMissing", subject: "J.2", facts: { journey: [["J.2", "s9"]], step: [["J.2", "s1"]], stepEnd: [["J.2", "s1"]] } },
    { name: "next step missing", rule: "journey.nextDangling", subject: "J.1", facts: { stepNext: [["J.1", "s2", "ghost"]] } },
    { name: "no end step", rule: "journey.noEnd", subject: "J.3", relation: "missing", facts: { journey: [["J.3", "s1"]], step: [["J.3", "s1"]] } },
    { name: "step ref missing", rule: "journey.stepRefMissing", subject: "J.1", facts: { stepRef: [["J.1", "s2", "ghost"]] } },
    {
      name: "unresolved step may refer to nothing", rule: "journey.stepRefMissing", subject: "J.1", relation: "none",
      facts: { stepRef: [["J.1", "s2", "ghost"]], stepUnresolved: [["J.1", "s2"]] },
    },
    { name: "screen in no journey", rule: "journey.screenUncovered", subject: "screen.b", facts: { node: [["screen.b", "screen", "thing.a"]] } },
    { name: "operation in no journey", rule: "journey.operationUncovered", subject: "op.b", facts: { node: [["op.b", "operation", "thing.a"]] } },
  ],
};
