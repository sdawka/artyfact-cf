import { Hono } from "hono";

import type { AppEnv } from "./app";

/** `GET /api/systems/:id/events`: SSE stream held by the System's DO (`data: {type, at, ...}`, `ping` every 15 s). */
export const events = new Hono<AppEnv>().get("/systems/:id/events", (c) => c.env.SYSTEMS.getByName(c.req.param("id")).fetch(c.req.raw));
