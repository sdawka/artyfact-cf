import { Hono } from "hono";
import { checkpoint, packet, realizationView, reject, review, submit, sync, systemForRealization, systemsHoldingRealization, systemStub } from "../service";
import { requireAdmin, requireRealizationSecret } from "../auth";
import { rebase } from "../rebase";
import { body, type AppEnv, type Ctx } from "./app";

type Resolve = (c: Ctx) => Promise<string>;
/** System ids that may hold the realization in the path, without throwing (an unknown one yields none). */
type Holders = (c: Ctx) => Promise<string[]>;

/**
 * The same realization routes under three prefixes:
 * `/systems/:id/evolutions/:eid/realizations/:rid` (CLI), `/systems/:id/realizations/:rid`,
 * and `/realizations/:rid` (System resolved through the registry).
 */
function mount(app: Hono<AppEnv>, prefix: string, system: Resolve, holders: Holders) {
  const rid = (c: Ctx) => c.req.param("rid")!;
  /** The System id, once the caller holds this realization's secret or the admin bearer. The secret is checked first. */
  const authed = async (c: Ctx) => {
    const who = await requireRealizationSecret(c.env, c.req.header("authorization"), async () =>
      Promise.all((await holders(c)).map(async (systemId) => ({ systemId, hash: await systemStub(c.env, systemId).realizationSecretHash(rid(c)) }))));
    // Only the admin reaches the resolver's 404 / 409 `ambiguous`.
    return who.admin ? system(c) : who.systemId;
  };
  app.get(prefix, async (c) => c.json(await realizationView(c.env, await authed(c), rid(c))));
  app.get(`${prefix}/packet`, async (c) => c.json(await packet(c.env, await authed(c), rid(c))));
  app.get(`${prefix}/review`, async (c) => c.json(await review(c.env, await system(c), rid(c))));
  app.post(`${prefix}/checkpoints`, async (c) => c.json(await checkpoint(c.env, await authed(c), rid(c), await body(c)), 201));
  app.post(`${prefix}/submit`, async (c) => {
    const out = await submit(c.env, await authed(c), rid(c), await body(c), "cli");
    return c.json(out, out.created ? 201 : 200);
  });
  app.post(`${prefix}/reject`, requireAdmin, async (c) => c.json(await reject(c.env, await system(c), rid(c), await body(c))));
  app.post(`${prefix}/rebase`, requireAdmin, async (c) => c.json(await rebase(c.env, await system(c), rid(c))));
  app.post(`${prefix}/sync`, async (c) => c.json(await sync(c.env, await authed(c), rid(c))));
}

export const realizations = new Hono<AppEnv>();
const bySystem: Resolve = async (c) => c.req.param("id")!;
const ownSystem: Holders = async (c) => [c.req.param("id")!];
mount(realizations, "/systems/:id/evolutions/:eid/realizations/:rid", bySystem, ownSystem);
mount(realizations, "/systems/:id/realizations/:rid", bySystem, ownSystem);
mount(realizations, "/realizations/:rid", (c) => systemForRealization(c.env, c.req.param("rid")!), (c) => systemsHoldingRealization(c.env, c.req.param("rid")!));
realizations.get("/systems/:id/realizations", async (c) => c.json({ realizations: await systemStub(c.env, c.req.param("id")).realizations() }));
