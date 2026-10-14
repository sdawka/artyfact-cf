import { Hono } from "hono";
import type { ConflictsResponse, EvaluateCandidateResponse, EvaluationsResponse } from "../../shared/api";
import { requireAdmin } from "../auth";
import { conflicts, promote, reevaluate, systemStub } from "../service";
import { readEvidence } from "../evidence";
import { notFound } from "../errors";
import { body, type AppEnv } from "./app";

export const evaluations = new Hono<AppEnv>()
  .get("/systems/:id/candidates", async (c) => c.json({ candidates: await systemStub(c.env, c.req.param("id")).candidates({}) }))
  .post("/systems/:id/candidates/:cid/evaluate", requireAdmin, async (c) =>
    c.json<EvaluateCandidateResponse>(await reevaluate(c.env, c.req.param("id"), c.req.param("cid"))))
  .get("/systems/:id/evaluations", async (c) =>
    c.json<EvaluationsResponse>({ evaluations: await systemStub(c.env, c.req.param("id")).evaluations(c.req.query("candidate") || undefined) }))
  // An evidence image a visual check judged (observations[].images[].key), readable like the evaluations that cite it.
  .get("/systems/:id/evidence", async (c) => {
    const res = await readEvidence(c.env.EVIDENCE, c.req.param("id"), c.req.query("key") ?? "");
    if (!res) throw notFound("no such evidence image");
    return res;
  })
  .get("/systems/:id/conflicts", async (c) => c.json<ConflictsResponse>(await conflicts(c.env, c.req.param("id"))))
  .post("/systems/:id/promote", requireAdmin, async (c) => c.json(await promote(c.env, c.req.param("id"), await body(c))));
