import { Hono } from "hono";
import type { ConflictsResponse, EvaluationsResponse } from "../../shared/api";
import { requireAdmin } from "../auth";
import { conflicts, promote, systemStub } from "../service";
import { body, type AppEnv } from "./app";

export const evaluations = new Hono<AppEnv>()
  .get("/systems/:id/candidates", async (c) => c.json({ candidates: await systemStub(c.env, c.req.param("id")).candidates({}) }))
  .get("/systems/:id/evaluations", async (c) =>
    c.json<EvaluationsResponse>({ evaluations: await systemStub(c.env, c.req.param("id")).evaluations(c.req.query("candidate") || undefined) }))
  .get("/systems/:id/conflicts", async (c) => c.json<ConflictsResponse>(await conflicts(c.env, c.req.param("id"))))
  .post("/systems/:id/promote", requireAdmin, async (c) => c.json(await promote(c.env, c.req.param("id"), await body(c))));
