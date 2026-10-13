import { Hono } from "hono";
import type { DeleteSystemResponse, ImportReviewAccept, ImportSystemRequest, SystemsResponse } from "../../shared/api";
import { requireAdmin } from "../auth";
import { notFound } from "../errors";
import { acceptImportReview, deleteSystem, importReview, importSystem, listSystems, modelBundle, readiness, systemStub } from "../service";
import { body, origin, type AppEnv } from "./app";

export const systems = new Hono<AppEnv>()
  .get("/systems", async (c) => c.json<SystemsResponse>({ systems: await listSystems(c.env) }))
  .post("/systems/import", requireAdmin, async (c) => c.json(await importSystem(c.env, (await body(c)) as Partial<ImportSystemRequest>), 201))
  .delete("/systems/:id", requireAdmin, async (c) => c.json<DeleteSystemResponse>(await deleteSystem(c.env, c.req.param("id"))))
  .get("/systems/:id", async (c) => {
    const s = await systemStub(c.env, c.req.param("id")).summary();
    if (!s) throw notFound(`system ${c.req.param("id")} is not imported`);
    return c.json(s);
  })
  .get("/systems/:id/import-review", async (c) => c.json(await importReview(c.env, c.req.param("id"))))
  .post("/systems/:id/import-review/accept", requireAdmin, async (c) =>
    c.json(await acceptImportReview(c.env, c.req.param("id"), (await body(c)) as Partial<ImportReviewAccept>, origin(c))))
  .get("/systems/:id/model", async (c) => c.json(await modelBundle(c.env, c.req.param("id"), c.req.query("rev"))))
  .get("/systems/:id/readiness", async (c) => c.json(await readiness(c.env, c.req.param("id"), c.req.query("rev"))));
