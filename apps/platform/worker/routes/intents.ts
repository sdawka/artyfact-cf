import { Hono } from "hono";
import { requireAdmin } from "../auth";
import { notImplemented } from "../errors";
import type { AppEnv } from "./app";

// Iteration-3 intent routes (W0 stubs): declared with their wire types in shared/api.ts, answering 501 until W7
// builds them. Admin only, like creating an Evolution: a proposal is the first step of a Genome change.
const stub = (what: string) => () => {
  throw notImplemented(`${what} is not implemented yet`);
};

export const intents = new Hono<AppEnv>()
  .post("/systems/:id/intents", requireAdmin, stub("describing a change"))
  .get("/systems/:id/intents/:pid", requireAdmin, stub("reading a proposal"))
  .post("/systems/:id/intents/:pid/reply", requireAdmin, stub("replying to a proposal"))
  .post("/systems/:id/intents/:pid/accept", requireAdmin, stub("accepting a proposal"));
