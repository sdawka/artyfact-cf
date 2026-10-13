/** Hook selection for Evolutions created through the API (they live only in the DO, not in the Genome). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSystemOne } from "@artyfact/semantic";
import type { CreateEvolutionResponse, Evaluation, SubmitResponse } from "../shared/api";
import { setArtifactsOverride } from "../worker/artifacts/client";
import { resetHooks, setHooks } from "../worker/hooks/index";
import { createHookRunner } from "../worker/hooks/run";
import { ADMIN, call, importFresh, submitApp } from "./helpers/flows";

/** The preview's `/health` answer; `null` makes the fake fetch throw (no preview should be contacted). */
let buildId: string | null = null;
const fetched: string[] = [];
const fakeFetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  fetched.push(url);
  if (buildId === null) throw new Error("no preview expected");
  return Response.json({ status: "ok", buildId });
}) as typeof fetch;

beforeEach(() => {
  buildId = null;
  fetched.length = 0;
  setHooks({ runner: () => createHookRunner({ s1: createSystemOne({}), fetch: fakeFetch, previewEnv: {} }) });
});
afterEach(() => { setArtifactsOverride(undefined); resetHooks(); });

const by = (evs: Evaluation[], criterion: string) => evs.filter((e) => e.criterion === criterion);
const PEOPLE = { "src/ui/people/index.html": "<main>people</main>" };

describe("hook selection: API-created evolutions", () => {
  it("evaluates the DO Evolution's acceptance criteria: C.webapp.health not-run without a preview, pass once it answers", async () => {
    const f = await importFresh();
    const created = await call<CreateEvolutionResponse>("POST", `/systems/${f.systemId}/evolutions`,
      { title: "Health", intent: "Answer /health", kind: "implementation", affectedNodes: ["screen.people"], acceptanceCriteria: ["C.webapp.health"] }, ADMIN);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const evo = created.json.evolution.id;

    const s = await submitApp(f, PEOPLE, evo);
    // Re-submitting the same commit without a preview returns the stored evaluations without re-running.
    const first = (await call<SubmitResponse>("POST", `/systems/${f.systemId}/realizations/${s.rid}/submit`, { commit: s.commit })).json.evaluations;
    expect(first.some((e) => e.criterion.startsWith("C.evolution-missing"))).toBe(false);
    const health = by(first, "C.webapp.health");
    expect(health).toHaveLength(1);
    expect(health[0]).toMatchObject({ hook: "hook.webapp.health", execution: "not-run", verdict: "unknown", provenance: { selectedBy: "acceptance" } });
    expect(fetched).toEqual([]);

    // The preview arrives (the CI build's url): the hooks re-run and the health check passes on the commit's build id.
    buildId = s.commit;
    const url = `https://kit-app-r${f.forks}.acct.workers.dev`;
    const again = await call<SubmitResponse>("POST", `/systems/${f.systemId}/realizations/${s.rid}/submit`, { commit: s.commit, previewUrl: url });
    expect(again.status, JSON.stringify(again.json)).toBeLessThan(300);
    expect(fetched).toEqual([`${url}/health`]);
    const passed = by(again.json.evaluations, "C.webapp.health").find((e) => e.execution === "completed");
    expect(passed).toMatchObject({ hook: "hook.webapp.health", verdict: "pass", targetRef: url });
    expect(again.json.evaluations.some((e) => e.criterion.startsWith("C.evolution-missing"))).toBe(false);
  });

  it("a Genome-declared Evolution selects exactly what it did before", async () => {
    const f = await importFresh();
    const s = await submitApp(f, PEOPLE);
    const sub = await call<SubmitResponse>("POST", `/systems/${f.systemId}/realizations/${s.rid}/submit`, { commit: s.commit });
    const pairs = sub.json.evaluations.map((e) => `${e.criterion}|${e.hook}|${e.provenance.selectedBy}`);
    // Recorded against main before the DO fallback existed.
    expect(pairs).toEqual([
      "C.people.audit|hook.people.audit|subject",
      "C.people.lint|hook.people.lint|subject",
      "C.people.list|hook.people.list|acceptance",
      "C.people.sorted|none|acceptance",
      "C.system.promotion|hook.system.scope|system-gate",
    ]);
  });
});
