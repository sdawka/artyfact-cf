import { describe, expect, it } from "vitest";
import type { Readiness } from "@artyfact/model";
import type { Evaluation } from "../shared/api";
import { modelViews, readinessReport } from "../worker/model-bundle";

const ev = (hook: string, verdict: Evaluation["verdict"], execution: Evaluation["execution"] = "completed", at = "2026-10-01T00:00:00Z"): Evaluation => ({
  id: hook, candidate: "cand.1", criterion: "C.system.topology", hook, ownerId: "system", subjectId: "system", targetRef: "genome@x",
  execution, verdict, verifier: "v", startedAt: at, finishedAt: at, observations: [], limitations: [], provenance: {},
});
const criteria = [{ id: "C.system.topology", targetKind: "model", gates: ["promotion"] }] as never;
const rules = { findings: [] } as unknown as Readiness;

describe("readinessReport folds rows per criterion like the gate", () => {
  it("a failing model-rules row and a later passing system-one row count as fail, never pass", () => {
    const r = readinessReport({ criteria }, rules, [ev("hook.system.topology", "fail"), ev("hook.system.topology.semantic", "pass", "completed", "2026-10-01T00:00:09Z")]);
    expect(r.implementationConformance).toMatchObject({ pass: 0, fail: 1 });
  });
  it("passes only when every hook's row passes; off-trigger not-run rows are ignored, others are not", () => {
    const pass = [ev("hook.a", "pass"), ev("hook.b", "pass")];
    expect(readinessReport({ criteria }, rules, pass).implementationConformance).toMatchObject({ pass: 1 });
    const pending = [...pass, ev("hook.deploy", "unknown", "not-run")];
    expect(readinessReport({ criteria }, rules, pending).implementationConformance).toMatchObject({ pass: 0, notRun: 1 });
    const hooks = [{ id: "hook.deploy", triggers: ["deployment"] }] as never;
    expect(readinessReport({ criteria, hooks }, rules, pending).implementationConformance).toMatchObject({ pass: 1 });
  });
});

describe("modelViews serialises the composed template's hints", () => {
  it("resolves every declared kind with defaults and keeps the layer order", () => {
    const layers = [{ id: "runtime", label: "Runtime" }, { id: "intent", label: "Intent" }];
    const template = {
      kinds: {
        endpoint: { fields: [{ name: "auth" }, { name: "route" }], view: { glyph: "⇄", colour: "teal", layer: "runtime", fields: ["route"] } },
        gizmo: {},
      },
      view: { layers },
    } as never;
    const v = modelViews(template);
    expect(v.layers).toEqual(layers);
    expect(Object.keys(v.kinds)).toEqual(["endpoint", "gizmo"]);
    expect(v.kinds.endpoint).toMatchObject({ label: "Endpoint", glyph: "⇄", colour: "teal", layer: "runtime", fields: ["route", "auth"] });
    expect(v.kinds.gizmo).toMatchObject({ label: "Gizmo", glyph: "•", colour: "neutral", fields: [] });
  });
});
