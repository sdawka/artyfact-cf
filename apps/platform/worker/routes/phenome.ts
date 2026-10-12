import { Hono } from "hono";
import type { PhenomeEventsResponse } from "../../shared/api";
import type { AppEnv } from "./app";

// Stub (B0): typed empty shapes until the Phenome slice (B4) implements these routes.

export const phenome = new Hono<AppEnv>()
  .get("/systems/:id/phenome/events", (c) => c.json<PhenomeEventsResponse>({ events: [], versions: [] }))
  .post("/systems/:id/phenome/events", (c) => c.json({ error: "not-implemented" }, 501));
