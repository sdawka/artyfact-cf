import { Hono } from "hono";
import type { StartWorkRequest, WorkResponse } from "../../shared/api";
import { requireAdmin } from "../auth";
import { notFound } from "../errors";
import { accept, candidatesView, startWork, systemStub } from "../service";
import { body, origin, type AppEnv, type Ctx } from "./app";

const work = async (c: Ctx) => c.json<WorkResponse>(await systemStub(c.env, c.req.param("id")!).work());

export const evolutions = new Hono<AppEnv>()
  .get("/systems/:id/work", work)
  .get("/systems/:id/evolutions", work)
  .get("/systems/:id/evolutions/:eid", async (c) => {
    const e = await systemStub(c.env, c.req.param("id")).evolution(c.req.param("eid"));
    if (!e) throw notFound(`unknown evolution ${c.req.param("eid")}`);
    return c.json(e);
  })
  .post("/systems/:id/evolutions/:eid/realizations", async (c) =>
    c.json(await startWork(c.env, c.req.param("id"), c.req.param("eid"), (await body(c)) as StartWorkRequest, origin(c)), 201))
  .get("/systems/:id/evolutions/:eid/realizations", async (c) =>
    c.json({ realizations: await systemStub(c.env, c.req.param("id")).realizations(c.req.param("eid")) }))
  .get("/systems/:id/evolutions/:eid/candidates", async (c) => c.json(await candidatesView(c.env, c.req.param("id"), c.req.param("eid"))))
  .post("/systems/:id/evolutions/:eid/accept", requireAdmin, async (c) =>
    c.json(await accept(c.env, c.req.param("id"), c.req.param("eid"), await body(c))));
