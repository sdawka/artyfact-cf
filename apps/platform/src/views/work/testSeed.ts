import type { QueryClient } from "@tanstack/react-query";
import { vi } from "vitest";
import type { ConflictReport } from "../../../shared/api";
import { fixtureBundle } from "@/api/fixtures";
import { qk } from "@/api/queries";
import { SYSTEM, candidate, commit, evaluation, realization } from "./testData";

/** Test-only seeds for Work and Review: query cache data and a stub backend. */
export const EVO1 = "evolution.1";
// Same selection rule as the server (target unknown here, so both): acceptance criteria plus artifact- and model-targeted ones, promotion-gated, not deferred.
export const REQUIRED = fixtureBundle().model.criteria
  .filter((c) => !c.deferred && c.gates.includes("promotion") && (fixtureBundle().model.evolutions[0]!.acceptanceCriteria.includes(c.id) || (c.targetKind === "artifact" || c.targetKind === "model")))
  .map((c) => c.id);
/** The server's gate set for cand.1 (candidates response `gates`): hard criteria block, the rest are advisories. */
export const GATES = {
  "cand.1": REQUIRED.map((id) => {
    const severity = fixtureBundle().model.criteria.find((c) => c.id === id)!.severity ?? "hard";
    return { id, severity, blocking: severity === "hard" };
  }),
};
export const evalFor = (c: string, o = {}) => evaluation({ id: `e.${c}`, criterion: c, hook: `hook.${c}`, ...o });

export interface Seed { gates?: typeof GATES | null; api?: boolean; evals?: ReturnType<typeof evaluation>[]; conflicts?: ConflictReport[]; commits?: ReturnType<typeof commit>[]; realizations?: ReturnType<typeof realization>[]; candidates?: ReturnType<typeof candidate>[] }
export const seed = (s: Seed = {}) => (qc: QueryClient) => {
  if (s.api) qc.setQueryData(qk.model(SYSTEM, "head"), { ...fixtureBundle(), source: "api" as const });
  qc.setQueryData(qk.evolutions(SYSTEM), { evolutions: [], realizations: s.realizations ?? [] });
  qc.setQueryData(qk.candidates(SYSTEM, EVO1), { evolution: EVO1, candidates: s.candidates ?? [candidate()], evaluations: [], conflicts: [], ...(s.gates !== null && { gates: s.gates ?? GATES }) });
  qc.setQueryData(qk.evaluations(SYSTEM, undefined), { evaluations: s.evals ?? [] });
  qc.setQueryData(qk.conflicts(SYSTEM), { conflicts: s.conflicts ?? [] });
  qc.setQueryData(qk.history(SYSTEM), { commits: s.commits ?? [] });
};

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** A backend that serves the seeded data again on refetch and answers promote with `promote()`. */
export const stubApi = (promote: () => Response, evals: ReturnType<typeof evaluation>[]) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/api/systems")) return json(200, [{ systemId: SYSTEM, title: "KiT", head: null, genomeRepo: "g", appRepo: "a", genomeCommit: "g", evolutionCounts: {}, updatedAt: "" }]);
    if (u.endsWith("/promote")) return promote();
    if (u.includes("/model")) return json(200, fixtureBundle());
    if (u.includes("/candidates")) return json(200, { evolution: EVO1, candidates: [candidate()], evaluations: [], conflicts: [], gates: GATES });
    if (u.includes("/evaluations")) return json(200, { evaluations: evals });
    if (u.includes("/evolutions")) return json(200, { evolutions: [], realizations: [] });
    if (u.includes("/conflicts")) return json(200, { conflicts: [] });
    if (u.includes("/history")) return json(200, { commits: [] });
    return json(404, { error: { code: "not-found", message: "no" } });
  }));

