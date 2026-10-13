import { Hono } from "hono";
import { requireAdmin } from "../auth";
import { getPlan, makePlan, updatePlan } from "../tasks/planner";
import { body, type AppEnv } from "./app";

// Tasks, waves and claims (docs/design/backend.md B.9).
export const tasks = new Hono<AppEnv>()
  // plan
  .get("/systems/:id/evolutions/:eid/plan", async (c) => c.json(await getPlan(c.env, c.req.param("id"), c.req.param("eid"))))
  .post("/systems/:id/evolutions/:eid/plan", requireAdmin, async (c) =>
    c.json(await makePlan(c.env, c.req.param("id"), c.req.param("eid"), await body(c)), 201))
  .put("/systems/:id/evolutions/:eid/plan", requireAdmin, async (c) =>
    c.json(await updatePlan(c.env, c.req.param("id"), c.req.param("eid"), await body(c))));
