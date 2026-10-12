import { Hono } from "hono";
import type { BuildsResponse, DeploymentsResponse } from "../../shared/api";
import type { AppEnv, Ctx } from "./app";

// Stub (B0): typed empty shapes until the builds/deployments slice (B3) implements these routes.

const notImplemented = (c: Ctx) => c.json({ error: "not-implemented" }, 501);
const none = (c: Ctx) => c.json<BuildsResponse>({ builds: [] });

export const builds = new Hono<AppEnv>()
  .get("/systems/:id/realizations/:rid/builds", none)
  .post("/systems/:id/realizations/:rid/builds", notImplemented)
  .get("/systems/:id/builds", none)
  .post("/systems/:id/builds", notImplemented)
  .get("/systems/:id/deployments", (c) => c.json<DeploymentsResponse>({ production: null, history: [] }))
  .post("/systems/:id/deployments", notImplemented)
  .post("/systems/:id/deployments/:did/ingest-token", notImplemented);
