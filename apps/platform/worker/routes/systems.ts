import { Hono } from "hono";
import type { ImportSystemRequest, SystemsResponse } from "../../shared/api";
import { requireAdmin } from "../auth";
import { notFound } from "../errors";
import { importSystem, modelBundle, readiness, registryStub, systemStub } from "../service";
import { body, type AppEnv } from "./app";

export const systems = new Hono<AppEnv>()
  .get("/systems", async (c) => c.json<SystemsResponse>({ systems: await registryStub(c.env).listSystems() }))
  .post("/systems/import", requireAdmin, async (c) => c.json(await importSystem(c.env, (await body(c)) as Partial<ImportSystemRequest>), 201))
  .get("/systems/:id", async (c) => {
    const s = await systemStub(c.env, c.req.param("id")).summary();
    if (!s) throw notFound(`system ${c.req.param("id")} is not imported`);
    return c.json(s);
  })
  .get("/systems/:id/model", async (c) => c.json(await modelBundle(c.env, c.req.param("id"), c.req.query("rev"))))
  .get("/systems/:id/readiness", async (c) => c.json(await readiness(c.env, c.req.param("id"), c.req.query("rev"))));
