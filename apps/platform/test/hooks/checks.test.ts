/** checks@1 on changed nodes only: the engine-gates checks hook with the fake and off providers. */
import { describe, expect, it } from "vitest";
import { fakeSystemOne, offSystemOne, type SystemOne } from "@artyfact/ontology";
import type { CandidateRef, Evaluation, FileMap, SubmissionContext } from "../../worker/hooks/contract";
import { engineRun, judgeChecks } from "../../worker/hooks/engine-gates";
import { createHookRunner } from "../../worker/hooks/run";
import { BASE, COMMIT, miniGenome } from "./fixtures";

const SIGNIFIERS = "check:screen.signifiers";

/** A v2 tree: a System with a section holding two screens (the base template's `screen` kind has the signifiers check). */
function tree(home = "Lists contacts; tapping a row opens it.", people = "Shows people; the add button opens a dialog."): FileMap {
  return {
    "node.yaml": "id: system.demo\nkind: system\nfields:\n  name: Demo\n",
    "section.ui/node.yaml": "id: section.ui\nkind: section\nfields:\n  name: UI\n",
    "section.ui/screen.home/node.yaml": `id: screen.home\nkind: screen\nfields:\n  name: Home\n  description: "${home}"\n`,
    "section.ui/screen.people/node.yaml": `id: screen.people\nkind: screen\nfields:\n  name: People\n  description: "${people}"\n`,
  };
}

/** Records every subject System One is asked about. */
function spy(inner: SystemOne = fakeSystemOne()) {
  const asked: { subject: string; questions: string[] }[] = [];
  const s1: SystemOne = {
    ...inner,
    ask: (state, questions, o) => {
      asked.push({ subject: String((state as { subject?: { id?: string } }).subject?.id), questions: Object.keys(questions) });
      return inner.ask(state, questions, o);
    },
  };
  return { s1, asked };
}

describe("judgeChecks", () => {
  it("passes a changed node whose check the fake answers benignly, asking about that node only", async () => {
    const { s1, asked } = spy();
    const o = await judgeChecks(engineRun(tree()), ["screen.home"], s1);
    expect(o).toMatchObject({ execution: "completed", verdict: "pass", provenance: { provider: "fake", calls: 1 } });
    expect(asked).toEqual([{ subject: "screen.home", questions: [SIGNIFIERS] }]);
    expect(o.observations).toContainEqual(expect.objectContaining({ rule: `semantic:${SIGNIFIERS}`, subject: "screen.home", level: "pass" }));
  });

  it("fails a changed node the fake answers no (#s1no)", async () => {
    const o = await judgeChecks(engineRun(tree("Lists contacts. #s1no")), ["screen.home"], fakeSystemOne());
    expect(o).toMatchObject({ verdict: "fail" });
    expect(o.interpretation).toContain(`semantic:${SIGNIFIERS} screen.home`);
  });

  it("never asks about unchanged nodes: a failing check elsewhere does not count", async () => {
    const { s1, asked } = spy();
    const o = await judgeChecks(engineRun(tree("Lists contacts.", "Shows people. #s1no")), ["screen.home"], s1);
    expect(o.verdict).toBe("pass");
    expect(asked.map((a) => a.subject)).toEqual(["screen.home"]);
    expect(o.observations[0]).toEqual({ kind: "checks-scope", nodes: ["screen.home", "section.ui"] });
  });

  it("asks once per changed node and nothing when no changed node carries a check", async () => {
    const both = spy();
    await judgeChecks(engineRun(tree()), ["screen.home", "screen.people"], both.s1);
    expect(both.asked.map((a) => a.subject).sort()).toEqual(["screen.home", "screen.people"]);
    const none = spy();
    const o = await judgeChecks(engineRun(tree()), ["section.ui"], none.s1);
    expect(none.asked).toEqual([]);
    expect(o).toMatchObject({ verdict: "pass" });
    expect(o.limitations[0]).toMatch(/^vacuous/);
  });

  it("is unknown with provider provenance when System One is off", async () => {
    const o = await judgeChecks(engineRun(tree()), ["screen.home"], offSystemOne());
    expect(o).toMatchObject({ verdict: "unknown", provenance: { provider: "off" } });
    expect(o.limitations.join(" ")).toContain("off or failed");
  });
});

describe("model-rules hook with packs checks@1", () => {
  const checksCriterion = [
    "  - id: C.webapp.checks",
    "    title: Changed screens meet their checks",
    "    claim: Every changed node meets the checks its kind declares.",
    "    ownerKind: thing",
    "    ownerId: thing.webapp",
    "    subjectKind: screen",
    "    subjectId: screen.people",
    "    targetKind: model",
    "    gates: [submission]",
    "    hooks: [hook.webapp.checks]",
  ].join("\n");
  const checksHook = [
    "  - id: hook.webapp.checks",
    "    assay: Template checks on changed nodes",
    "    criteria: [C.webapp.checks]",
    "    tier: semantic",
    "    engine: model-rules",
    "    targetKind: model",
    "    triggers: [submission]",
    '    inputs: { packs: "checks@1" }',
    "    binding: bound",
  ].join("\n");

  function genome(description: string): FileMap {
    const files = miniGenome();
    const criteria = "things/webapp/criteria.yaml";
    const ontology = "things/webapp/ontology.yaml";
    const out = {
      ...files,
      [criteria]: files[criteria].replace("criteria:\n", `criteria:\n${checksCriterion}\n`).replace("hooks:\n", `hooks:\n${checksHook}\n`),
      [ontology]: files[ontology].replace("  - id: screen.people\n    kind: screen\n", `  - id: screen.people\n    kind: screen\n    description: "${description}"\n`),
    };
    if (out[criteria] === files[criteria] || out[ontology] === files[ontology]) throw new Error("fixture mutation did not apply");
    return out;
  }

  const candidate: CandidateRef = {
    id: "cand.r1", realizationId: "realization.1.r1", evolutionId: "evolution.1", target: "app", commit: COMMIT, baseCommit: BASE,
    changedPaths: ["src/ui/people/PeopleScreen.tsx"], changedNodes: ["screen.people"], pathNodes: { "src/ui/people/PeopleScreen.tsx": ["screen.people"] },
  };
  const ctx = (genomeFiles: FileMap): SubmissionContext => ({
    systemId: "system.mini-kit", candidate, genomeCommit: BASE, genomeFiles, tree: [], permittedPaths: ["src/**"], protectedPaths: [], openCandidates: [],
  });
  const checksOf = (evs: Evaluation[]) => evs.find((e) => e.criterion === "C.webapp.checks")!;

  it("passes on the fake and fails on #s1no, with System One provenance", async () => {
    const runner = createHookRunner({ s1: fakeSystemOne() });
    const pass = checksOf(await runner.runSubmission(ctx(genome("Shows people; the add button opens a dialog."))));
    expect(pass).toMatchObject({ hook: "hook.webapp.checks", execution: "completed", verdict: "pass" });
    expect(pass.provenance).toMatchObject({ provider: "fake", model: "fake" });
    const fail = checksOf(await runner.runSubmission(ctx(genome("Shows people. #s1no"))));
    expect(fail).toMatchObject({ execution: "completed", verdict: "fail" });
  });
});
