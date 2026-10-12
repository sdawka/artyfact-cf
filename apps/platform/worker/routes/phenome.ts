import { Hono } from "hono";
import type { PhenomeEventsQuery } from "../../shared/api";
import { badRequest } from "../errors";
import { ingestEvents, ingestPrincipal, listEvents } from "../phenome";
import { body, type AppEnv } from "./app";

const int = (v: string | undefined, name: string) => {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw badRequest(`${name} must be a non-negative integer`);
  return n;
};

const limit = (v: string | undefined) => {
  const n = int(v, "limit");
  if (n === 0) throw badRequest("limit must be at least 1");
  return n;
};

export const phenome = new Hono<AppEnv>()
  .get("/systems/:id/phenome/events", async (c) => {
    const q = c.req.query();
    const query: PhenomeEventsQuery = {
      ...(q.deployment && { deployment: q.deployment }), ...(q.commit && { commit: q.commit }), ...(q.kind && { kind: q.kind }),
      ...(q.realization && { realization: q.realization }), limit: limit(q.limit), before: int(q.before, "before"),
    };
    return c.json(await listEvents(c.env, c.req.param("id"), query));
  })
  .post("/systems/:id/phenome/events", async (c) => {
    const id = c.req.param("id");
    const principal = await ingestPrincipal(c.env, id, c.req.header("authorization"));
    return c.json(await ingestEvents(c.env, id, principal, await body(c)));
  });
