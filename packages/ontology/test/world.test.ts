import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorldSnapshot } from "../src/adapters/world/contracts.ts";
import { describe, expect, it } from "vitest";
import { applyMutation, type Mutation } from "./fixtures/world/mutate.mjs";
import { checkTemplateForm, evaluate, TemplateFormError, type Readiness } from "../src/index.ts";
import { toWorldFindings, worldSnapshotToGraph, worldStatus, worldTemplateToMeta, type WorldStatus } from "../src/adapters/world/index.ts";
import type { DerivationTree } from "@artyfact/rules";

const EXPECTED = join(import.meta.dirname, "fixtures/world/expected");

/** Every WorldSnapshot fixture; `assistant-impact-evidence.json` holds evidence bindings, not a snapshot (the regen script stayed in bropilot). */
const FIXTURES = [
  "assistant-valid", "assistant-missing", "assistant-conflict", "assistant-unknown",
  "assistant-impact-baseline", "assistant-impact-calendar-adapter", "assistant-impact-completion",
  "assistant-impact-incomplete", "assistant-impact-interface", "assistant-impact-metric-definition",
  "assistant-impact-removed-dependency",
];

const MUTATIONS: Mutation[] = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/world/mutations.json"), "utf8"));
const key = (ruleId: string, severity: string, objectIds: string[]) => JSON.stringify([ruleId, severity, objectIds]);

/**
 * Every place the engine and world-core disagree on a case, and why. A case not listed agrees exactly.
 * `extra` are world-core-coded findings only the engine reports, `unmapped` are engine findings without a
 * world-core code beyond the undeclared-property warnings, `status` is the engine's status where it differs,
 * and `formInvalid` lists the form findings that stop the engine from evaluating at all.
 */
const DIFFERENCES: Record<string, { why: string; extra?: string[]; unmapped?: string[]; status?: WorldStatus; formInvalid?: string[] }> = {
  "mutation-empty-required-property": {
    why: "world-core tests property presence; the engine drops empty strings when it emits fields, so an empty required property is missing.",
    extra: [key("core.shape-required-properties", "blocker", ["block-french-tuesday"])],
    unmapped: [],
    status: "blocked",
  },
  "mutation-unknown-shape-with-thing": {
    why: "the object's Thing link starts at a kind ws.ofThing does not list, so core link.endpoint fires besides core.shape-known.",
    unmapped: ["error link.endpoint block-french-tuesday"],
  },
  "mutation-parent-cycle": {
    why: "world-core does not check containment; core metamodel@1 rejects a parent cycle.",
    unmapped: ["error tree.cycle goal-french", "error tree.cycle task-french-listening"],
    status: "blocked",
  },
  "mutation-unsatisfiable-requirement": {
    why: "a required relation whose endpoints exclude the subject kind is a form error in meta@1; world-core evaluates and reports a blocker per subject.",
    formInvalid: ["kind.relationUnsatisfiable goal"],
  },
};

interface RustFinding { ruleId: string; severity: string; objectIds: string[]; message: string }
interface Oracle { status: "ready" | "blocked" | "unknown"; findings: RustFinding[] }

const fixtureOf = (name: string): WorldSnapshot => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/world/snapshots", `${name}.json`), "utf8"));
const snapshotOf = (name: string): WorldSnapshot => {
  const m = MUTATIONS.find((x) => `mutation-${x.name}` === name);
  return m ? applyMutation(fixtureOf("assistant-valid"), m) : fixtureOf(name);
};
const CASES = [...FIXTURES, ...MUTATIONS.map((m) => `mutation-${m.name}`)];
const EVALUATED = CASES.filter((c) => !DIFFERENCES[c]?.formInvalid);
const oracleOf = (name: string): Oracle => JSON.parse(readFileSync(join(EXPECTED, `${name}.readiness.json`), "utf8"));

function run(snapshot: WorldSnapshot): Readiness {
  const template = worldTemplateToMeta(snapshot);
  return evaluate(template, worldSnapshotToGraph(snapshot, template));
}

/**
 * Status mapping, Rust `ReadinessStatus` to engine flags:
 * - ready:   actionable. Not necessarily buildable; see EXTRA below.
 * - blocked: not actionable, and at least one finding is an `error` (a Rust `blocker`).
 * - unknown: not actionable, no `error`, at least one `missing` (a Rust `unknown`).
 */
const STATUS: Record<WorldStatus, (r: Readiness) => boolean> = {
  ready: (r) => r.actionable,
  blocked: (r) => !r.actionable && r.findings.some((f) => f.level === "error"),
  unknown: (r) => !r.actionable && !r.findings.some((f) => f.level === "error") && r.findings.some((f) => f.level === "missing"),
};

/**
 * The one documented difference on these fixtures: world-core objects have open properties, a meta@1 kind declares
 * its fields. A shape lists only required properties, so every other property is `field.unknown`, a warning that
 * world-core has no code for. It keeps `buildable` false while the Rust status is ready.
 */
const EXTRA = (s: WorldSnapshot): string[] => {
  const required = new Map(s.template.objectShapes.map((x) => [x.kind, new Set(x.requiredProperties)]));
  return s.objects
    .filter((o) => required.has(o.kind) && Object.keys(o.properties).some((p) => !required.get(o.kind)?.has(p)))
    .map((o) => `warning field.unknown ${o.id}`)
    .sort();
};

const rustSet = (o: Oracle) =>
  [...new Set(o.findings.map((f) => JSON.stringify([f.ruleId, f.severity, f.objectIds])))].sort();
const engineSet = (r: Readiness, s: WorldSnapshot) =>
  toWorldFindings(r, s).findings.map((f) => JSON.stringify([f.ruleId, f.severity, f.objectIds])).sort();

function leaves(t: DerivationTree, out: DerivationTree[] = []): DerivationTree[] {
  if (!t.children.length) out.push(t);
  for (const c of t.children) leaves(c, out);
  return out;
}

describe("world snapshot adapter", () => {
  it.each(CASES)("%s: converted template form validity", (name) => {
    const form = checkTemplateForm(worldTemplateToMeta(snapshotOf(name)));
    expect(form.findings.map((f) => `${f.rule} ${f.subject}`)).toEqual(DIFFERENCES[name]?.formInvalid ?? []);
    expect(form.valid).toBe(!DIFFERENCES[name]?.formInvalid);
    if (!form.valid) expect(() => run(snapshotOf(name))).toThrow(TemplateFormError);
  });

  it.each(EVALUATED)("%s: findings match world-core by (code, severity, object ids)", (name) => {
    const s = snapshotOf(name);
    const expected = [...new Set([...rustSet(oracleOf(name)), ...(DIFFERENCES[name]?.extra ?? [])])].sort();
    expect(engineSet(run(s), s)).toEqual(expected);
  });

  it.each(EVALUATED)("%s: engine flags agree with the Rust status", (name) => {
    const s = snapshotOf(name);
    const r = run(s);
    const status = DIFFERENCES[name]?.status ?? oracleOf(name).status;
    expect(worldStatus(r)).toBe(status);
    for (const [k, holds] of Object.entries(STATUS)) expect(holds(r)).toBe(k === status);
    expect(r.buildable).toBe(status === "ready" && EXTRA(s).length === 0);
  });

  it.each(EVALUATED)("%s: findings without a world-core code are exactly the documented extras", (name) => {
    const s = snapshotOf(name);
    const { unmapped } = toWorldFindings(run(s), s);
    expect(unmapped.map((f) => `${f.level} ${f.rule} ${f.subject}`).sort()).toEqual([...EXTRA(s), ...(DIFFERENCES[name]?.unmapped ?? [])].sort());
  });

  it("every documented difference is a real disagreement with world-core", () => {
    for (const [name, d] of Object.entries(DIFFERENCES)) {
      expect(CASES).toContain(name);
      expect(d.extra?.length || d.unmapped?.length || d.status || d.formInvalid).toBeTruthy();
    }
  });

  it.each(EVALUATED)("%s: every finding has a derivation whose leaves are EDB facts", (name) => {
    for (const f of run(snapshotOf(name)).findings) {
      const ls = leaves(f.derivation);
      expect(ls.length).toBeGreaterThan(0);
      expect(ls.filter((l) => !l.edb).map((l) => `${f.rule}: ${l.relation}`)).toEqual([]);
      expect(f.facts.length).toBe(ls.length);
    }
  });

  it.each(EVALUATED)("%s: conversion and evaluation are byte-identical across runs", (name) => {
    const a = JSON.stringify(run(snapshotOf(name)));
    const b = JSON.stringify(run(snapshotOf(name)));
    expect(a).toBe(b);
  });

  it("assistant-unknown names the undeclared scope that world-core names in its message", () => {
    const s = snapshotOf("assistant-unknown");
    const scope = run(s).findings.filter((f) => f.rule === "scope.undeclared").map((f) => f.subject);
    expect(scope).toEqual(["ws:scope:outcome-links"]);
    expect(oracleOf("assistant-unknown").findings.find((f) => f.ruleId === "core.mandatory-scope-incomplete")?.message).toContain("outcome-links");
  });

  it("assistant-conflict reports each forbidden cycle node and the incompatible pair under the Rust rule ids", () => {
    const r = run(snapshotOf("assistant-conflict"));
    const world = r.findings.filter((f) => f.pack === "world.readiness@1").map((f) => `${f.rule} ${f.subject}`);
    expect(world).toEqual([
      "assistant.constraints-compatible ws:activeConstraints",
      "assistant.no-dependency-cycles calendar-1",
      "assistant.no-dependency-cycles planning-1",
    ]);
  });
});
