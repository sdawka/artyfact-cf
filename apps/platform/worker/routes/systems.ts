import { Hono } from "hono";
import type { DeleteSystemResponse, ImportSystemRequest, PlatformResponse, SystemImportReviewAccept, SystemsResponse } from "../../shared/api";
import { requireAdmin } from "../auth";
import { HOSTED_DEMO_NOTICE, isHostedDemo } from "../demo";
import { notFound } from "../errors";
import { catMode } from "../flags";
import { acceptImportReview, importReview } from "../import-review";
import { deleteSystem, importSystem, listSystems, modelBundle, readiness, systemStub } from "../service";
import { body, origin, type AppEnv } from "./app";

export const systems = new Hono<AppEnv>()
  .get("/platform", async (c) => {
    const cat = await catMode(c.env);
    return c.json<PlatformResponse>(isHostedDemo(c.env) ? { hostedDemo: true, notice: HOSTED_DEMO_NOTICE, catMode: cat } : { hostedDemo: false, catMode: cat });
  })
  .get("/systems", async (c) => c.json<SystemsResponse>({ systems: await listSystems(c.env) }))
  .post("/systems/import", requireAdmin, async (c) => c.json(await importSystem(c.env, (await body(c)) as Partial<ImportSystemRequest>), 201))
  .delete("/systems/:id", requireAdmin, async (c) => c.json<DeleteSystemResponse>(await deleteSystem(c.env, c.req.param("id"))))
  .get("/systems/:id", async (c) => {
    const s = await systemStub(c.env, c.req.param("id")).summary();
    if (!s) throw notFound(`system ${c.req.param("id")} is not imported`);
    return c.json(s);
  })
  .get("/systems/:id/model", async (c) => c.json(await modelBundle(c.env, c.req.param("id"), c.req.query("rev"))))
  .get("/systems/:id/readiness", async (c) => c.json(await readiness(c.env, c.req.param("id"), c.req.query("rev"))))
  // System import review (B.10): public read like the model; accepting (and removing rejected nodes) is admin only.
  .get("/systems/:id/import-review", async (c) => c.json(await importReview(c.env, c.req.param("id"))))
  .post("/systems/:id/import-review/accept", requireAdmin, async (c) =>
    c.json(await acceptImportReview(c.env, c.req.param("id"), (await body(c)) as Partial<SystemImportReviewAccept>, origin(c))));
