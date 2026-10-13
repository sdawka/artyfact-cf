import { describe, expect, it } from "vitest";
import {
  buildSlice, combine, decide, DEFAULT_THRESHOLDS, fakeAnswers, harmOf, hashOf, kindWording, QuestionSchema, readAnswer,
  scoreConfidence, SliceSchema, toWire, type Graph,
} from "../../src/index.ts";
import { clean } from "../fixture.ts";

const t = DEFAULT_THRESHOLDS;
const Q = (o: Record<string, unknown>) => QuestionSchema.parse({ benign: "no", policy: [{ answer: "yes", level: "warning" }], ...o });

describe("slice members and text cap", () => {
  const cand = { rule: "r", text: "t" };
  const g = (): Graph => {
    const x = clean();
    x.nodes.push({ id: "c9", kind: "person", parent: "b1", fields: { handle: "c9" } });
    return x;
  };

  it("adds direct children as members only when asked, filtered by kinds", () => {
    expect(buildSlice(g(), "b1", SliceSchema.parse({}), cand).members).toBeUndefined();
    const s = buildSlice(g(), "b1", SliceSchema.parse({ children: true }), cand);
    expect(s.members?.map((m) => m.id)).toEqual(["c1", "c2", "c9"]);
    expect(s.nodes).toEqual([]);
    expect(buildSlice(g(), "b1", SliceSchema.parse({ children: true, kinds: ["card"] }), cand).members?.map((m) => m.id)).toEqual(["c1", "c2"]);
  });

  it("takes members of both ends of a pair", () => {
    const x = g();
    x.nodes.push({ id: "c1a", kind: "card", parent: "c1", fields: { title: "sub" } });
    const s = buildSlice(x, "c1|c2", SliceSchema.parse({ children: true }), cand);
    expect(s.members?.map((m) => m.id)).toEqual(["c1a"]);
  });

  it("cuts long string fields to textCap", () => {
    const x = g();
    x.nodes[1]!.fields.title = "x".repeat(700);
    const s = buildSlice(x, "c1", SliceSchema.parse({}), cand);
    expect(String((s.subject as { fields: Record<string, unknown> }).fields.title)).toHaveLength(600);
    const short = buildSlice(x, "c1", SliceSchema.parse({ textCap: 10 }), cand);
    expect((short.subject as { fields: Record<string, unknown> }).fields).toMatchObject({ title: `${"x".repeat(9)}…`, priority: 1 });
  });

  it("hashes the follow-up origin of a candidate", () => {
    const spec = SliceSchema.parse({});
    const a = buildSlice(g(), "c1", spec, cand);
    const b = buildSlice(g(), "c1", spec, { ...cand, from: { question: "set.allHold", answer: "no" } });
    expect(hashOf(a)).not.toBe(hashOf(b));
  });
});

describe("toWire per kind", () => {
  const q = Q({
    id: "node.kind", answer: "yes-no",
    text: "Is state.subject a genuine {noun}? {instanceOf}",
    choices: ["Yes: it is a {noun}. {grounded}", "No: it is not a {noun}."],
    byKind: { a: JSON.stringify({ noun: "outcome", instanceOf: "An outcome is a change in the world.", grounded: "Names a metric." }), b: "feature" },
  });

  it("substitutes the kind's wording, or a plain noun", () => {
    expect(toWire(q, "a")).toMatchObject({
      instructions: "Is state.subject a genuine outcome? An outcome is a change in the world.",
      criteria: { true: "Yes: it is a outcome. Names a metric.", false: "No: it is not a outcome." },
    });
    expect(toWire(q, "b")).toMatchObject({ instructions: "Is state.subject a genuine feature?", criteria: { true: "Yes: it is a feature." } });
    expect(toWire(q, "zzz").instructions).toBe("Is state.subject a genuine zzz?");
    expect(kindWording(q)).toEqual({ noun: "item" });
  });

  it("hashes differently per kind and leaves text without placeholders alone", () => {
    expect(hashOf(toWire(q, "a"))).not.toBe(hashOf(toWire(q, "b")));
    const plain = Q({ id: "p", answer: "yes-no", text: "Two  spaces stay." });
    expect(toWire(plain, "a").instructions).toBe("Two  spaces stay.");
  });

  it("keeps choice keys and the 255-character cap", () => {
    const c = Q({ id: "c", answer: "choice", benign: "ok", choices: ["ok", "bad {noun}"], byKind: { a: "x".repeat(300) }, policy: [{ answer: "ok", level: "pass" }] });
    const w = toWire(c, "a");
    expect(Object.keys(w.criteria)).toEqual(["ok", "bad {noun}"]);
    expect((w.criteria as Record<string, string>)["bad {noun}"]).toHaveLength(255);
  });
});

describe("policy probabilities, combine and score confidence", () => {
  const yn = Q({ id: "y", answer: "yes-no", defect: "specificity", policy: [{ answer: "no", level: "pass" }, { answer: "yes", level: "warning" }] });

  it("reads noul as a yes/no distribution and carries the defect", () => {
    expect(readAnswer(yn, { type: "noul", noul: 0.2 })).toEqual({ answer: "no", confidence: 0.8, probabilities: { yes: 0.2, no: 0.8 } });
    expect(decide(yn, { type: "noul", noul: 0.95 }, t)).toMatchObject({ status: "confident", level: "warning", defect: "specificity", probabilities: { yes: 0.95 } });
    const own = Q({ ...yn, policy: [{ answer: "yes", level: "warning", defect: "specificity.abstract" }] });
    expect(decide(own, { type: "noul", noul: 0.95 }, t).defect).toBe("specificity.abstract");
    const choice = Q({ id: "c", answer: "choice", benign: "ok", policy: [{ answer: "ok", level: "pass" }] });
    expect(decide(choice, { type: "choice", choice: "ok", confidence: 0.9, probabilities: { ok: 0.9, bad: 0.1 } }, t).probabilities).toEqual({ ok: 0.9, bad: 0.1 });
    expect(harmOf(yn, readAnswer(yn, { type: "noul", noul: 0.7 }))).toBeCloseTo(0.7);
  });

  it("combines opposite-polarity answers", () => {
    expect(combine(0.95, 0.92, t)).toMatchObject({ status: "confident", harmful: true });
    expect(combine(0.7, 0.7, t)).toMatchObject({ status: "confident", harmful: true });
    expect(combine(0.6, 0.55, t)).toMatchObject({ status: "review", harmful: true });
    expect(combine(0.02, 0.05, t)).toMatchObject({ status: "confident", harmful: false });
    expect(combine(0.95, 0.1, t)).toMatchObject({ status: "review", harmful: true });
    expect(combine(0.3, 0.6, t)).toMatchObject({ status: "unknown" });
    expect(combine(0.97, undefined, t)).toMatchObject({ status: "review", harmful: true });
    expect(combine(undefined, undefined, t)).toEqual({ status: "unknown", confidence: 0 });
  });

  it("scores confidence as the mass on the chosen side of the pass boundary", () => {
    const p = { 0: 0.05, 1: 0.1, 2: 0.4, 3: 0.3, 4: 0.15 };
    expect(scoreConfidence(p, 3)).toBeCloseTo(0.55);
    expect(scoreConfidence(p, 3, 4)).toBeCloseTo(0.45);
    expect(scoreConfidence({}, 3)).toBe(0);
  });
});

describe("fake per-question directives", () => {
  const qs = {
    "set.allHold": toWire(Q({ id: "set.allHold", answer: "yes-no", benign: "yes", policy: [{ answer: "yes", level: "pass" }] })),
    "node.kind": toWire(Q({ id: "node.kind", answer: "yes-no", benign: "yes", policy: [{ answer: "yes", level: "pass" }] })),
    "which:instance": toWire(Q({ id: "which:instance", answer: "choice", benign: "none", choices: ["compound", "none"], policy: [{ answer: "none", level: "pass" }] })),
    "node.tangibility": toWire(Q({ id: "node.tangibility", answer: "score", benign: 4, choices: ["0", "1", "2", "3", "4"], policy: [{ answer: 4, level: "pass" }] })),
  };

  it("sets one question's answer and confidence, leaving the rest benign", () => {
    const a = fakeAnswers({ t: "#s1:set.allHold=no #s1:which:instance=compound #s1:node.tangibility=1 #s1low:node.kind" }, qs);
    expect(a["set.allHold"]).toEqual({ type: "noul", noul: 0.05 });
    expect(a["node.kind"]).toEqual({ type: "noul", noul: 0.55 });
    expect(a["which:instance"]).toMatchObject({ choice: "compound", confidence: 0.95 });
    expect(a["node.tangibility"]).toMatchObject({ score: 1, confidence: 0.95 });
  });

  it("answers a choice with the first key of a list that it offers", () => {
    expect(fakeAnswers({ t: "#s1:which:instance=absent,compound,none" }, qs)["which:instance"]).toMatchObject({ choice: "compound" });
    expect(fakeAnswers({ t: "#s1:which:instance=absent,other. Then text" }, qs)["which:instance"]).toMatchObject({ choice: "none" });
    expect(fakeAnswers({ t: "#s1:set.allHold=no,yes" }, qs)["set.allHold"]).toEqual({ type: "noul", noul: 0.05 });
  });

  it("does not match a question id by prefix and keeps global directives", () => {
    const a = fakeAnswers({ t: "#s1low:node.kindX #s1:set.allHoldX=no" }, qs);
    expect(a["node.kind"]).toEqual({ type: "noul", noul: 0.95 });
    expect(a["set.allHold"]).toEqual({ type: "noul", noul: 0.95 });
    const g = fakeAnswers({ t: "#s1low #s1pick:compound" }, qs);
    expect(g["node.kind"]).toEqual({ type: "noul", noul: 0.55 });
    expect(g["which:instance"]).toMatchObject({ choice: "compound", confidence: 0.3 });
  });
});
