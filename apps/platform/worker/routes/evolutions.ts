import { Hono } from "hono";
import type { StartWaveRequest, StartWorkRequest, WorkResponse } from "../../shared/api";
import { requireAdmin } from "../auth";
import { notFound } from "../errors";
import { accept, assertImportReviewed, candidatesView, createEvolution, startWave, startWork, systemStub } from "../service";
import { body, origin, type AppEnv, type Ctx } from "./app";

const work = async (c: Ctx) => c.json<WorkResponse>(await systemStub(c.env, c.req.param("id")!).work());

export const evolutions = new Hono<AppEnv>()
  .get("/systems/:id/work", work)
  .get("/systems/:id/evolutions", work)
  // Describe-a-change (CreateEvolutionRequest → CreateEvolutionResponse): admin only. No affectedNodes means an
  // unconstrained scope; no acceptanceCriteria defaults to the System's criteria matching the Evolution's target.
  .post("/systems/:id/evolutions", requireAdmin, async (c) => {
    await assertImportReviewed(c.env, c.req.param("id"));
    return c.json(await createEvolution(c.env, c.req.param("id"), await body(c)), 201);
  })
  .get("/systems/:id/evolutions/:eid", async (c) => {
    const e = await systemStub(c.env, c.req.param("id")).evolution(c.req.param("eid"));
    if (!e) throw notFound(`unknown evolution ${c.req.param("eid")}`);
    return c.json(e);
  })
  // Start work mints an Artifacts write token and a realization secret: admin only.
  .post("/systems/:id/evolutions/:eid/realizations", requireAdmin, async (c) => {
    await assertImportReviewed(c.env, c.req.param("id"));
    return c.json(await startWork(c.env, c.req.param("id"), c.req.param("eid"), (await body(c)) as StartWorkRequest, origin(c)), 201);
  })
  .get("/systems/:id/evolutions/:eid/realizations", async (c) =>
    c.json({ realizations: await systemStub(c.env, c.req.param("id")).realizations(c.req.param("eid")) }))
  // Claims and starts every task of a wave (admin: tokens and secrets appear once, in `started`).
  .post("/systems/:id/evolutions/:eid/waves/:n/start", requireAdmin, async (c) => {
    const n = c.req.param("n");
    return c.json(await startWave(c.env, c.req.param("id"), c.req.param("eid"), /^-?\d+$/.test(n) ? Number(n) : NaN, (await body(c)) as Partial<StartWaveRequest>, origin(c)));
  })
  .get("/systems/:id/evolutions/:eid/candidates", async (c) => c.json(await candidatesView(c.env, c.req.param("id"), c.req.param("eid"))))
  .post("/systems/:id/evolutions/:eid/accept", requireAdmin, async (c) =>
    c.json(await accept(c.env, c.req.param("id"), c.req.param("eid"), await body(c))));
