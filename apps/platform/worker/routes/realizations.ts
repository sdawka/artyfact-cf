import { Hono } from "hono";
import { checkpoint, packet, realizationView, review, submit, sync, systemForRealization, systemStub } from "../service";
import { body, type AppEnv, type Ctx } from "./app";

type Resolve = (c: Ctx) => Promise<string>;

/**
 * The same realization routes under three prefixes:
 * `/systems/:id/evolutions/:eid/realizations/:rid` (CLI), `/systems/:id/realizations/:rid`,
 * and `/realizations/:rid` (System resolved through the registry).
 */
function mount(app: Hono<AppEnv>, prefix: string, system: Resolve) {
  const rid = (c: Ctx) => c.req.param("rid")!;
  app.get(prefix, async (c) => c.json(await realizationView(c.env, await system(c), rid(c))));
  app.get(`${prefix}/packet`, async (c) => c.json(await packet(c.env, await system(c), rid(c))));
  app.get(`${prefix}/review`, async (c) => c.json(await review(c.env, await system(c), rid(c))));
  app.post(`${prefix}/checkpoints`, async (c) => c.json(await checkpoint(c.env, await system(c), rid(c), await body(c)), 201));
  app.post(`${prefix}/submit`, async (c) => {
    const out = await submit(c.env, await system(c), rid(c), await body(c), "cli");
    return c.json(out, out.created ? 201 : 200);
  });
  app.post(`${prefix}/sync`, async (c) => c.json(await sync(c.env, await system(c), rid(c))));
}

export const realizations = new Hono<AppEnv>();
const bySystem: Resolve = async (c) => c.req.param("id")!;
mount(realizations, "/systems/:id/evolutions/:eid/realizations/:rid", bySystem);
mount(realizations, "/systems/:id/realizations/:rid", bySystem);
mount(realizations, "/realizations/:rid", (c) => systemForRealization(c.env, c.req.param("rid")!));
realizations.get("/systems/:id/realizations", async (c) => c.json({ realizations: await systemStub(c.env, c.req.param("id")).realizations() }));
