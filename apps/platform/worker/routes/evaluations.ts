import { Hono } from "hono";
import type { ConflictsResponse, EvaluateCandidateResponse, EvaluationsResponse } from "../../shared/api";
import { requireAdmin, requireRealizationSecret } from "../auth";
import { conflicts, promote, reevaluate, systemStub } from "../service";
import { parseEvidenceKey, readEvidence } from "../evidence";
import { notFound } from "../errors";
import { body, type AppEnv } from "./app";

export const evaluations = new Hono<AppEnv>()
  .get("/systems/:id/candidates", async (c) => c.json({ candidates: await systemStub(c.env, c.req.param("id")).candidates({}) }))
  .post("/systems/:id/candidates/:cid/evaluate", requireAdmin, async (c) =>
    c.json<EvaluateCandidateResponse>(await reevaluate(c.env, c.req.param("id"), c.req.param("cid"))))
  .get("/systems/:id/evaluations", async (c) =>
    c.json<EvaluationsResponse>({ evaluations: await systemStub(c.env, c.req.param("id")).evaluations(c.req.query("candidate") || undefined) }))
  // An evidence image a visual check judged (observations[].images[].key). Not public: the admin bearer, or the secret of
  // the realization the key belongs to. Keys outside the System's evidence prefix are 404 before any lookup.
  .get("/systems/:id/evidence", async (c) => {
    const sid = c.req.param("id"), key = c.req.query("key") ?? "";
    const parsed = parseEvidenceKey(sid, key);
    await requireRealizationSecret(c.env, c.req.header("authorization"), async () => {
      if (!parsed) return [];
      try { return [{ systemId: sid, hash: await systemStub(c.env, sid).realizationSecretHash(parsed.realization) }]; } catch { return []; }
    });
    if (!parsed) throw notFound("no such evidence image");
    const res = await readEvidence(c.env.EVIDENCE, sid, key);
    if (!res) throw notFound("no such evidence image");
    return res;
  })
  .get("/systems/:id/conflicts", async (c) => c.json<ConflictsResponse>(await conflicts(c.env, c.req.param("id"))))
  .post("/systems/:id/promote", requireAdmin, async (c) => c.json(await promote(c.env, c.req.param("id"), await body(c))));
