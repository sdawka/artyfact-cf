import { Hono } from "hono";
import type { TasksQuery, TaskStatus } from "../../shared/api";
import { requireAdmin } from "../auth";
import { assertImportReviewed, claimTask, listTasks, releaseTask, taskView } from "../service";
import { getPlan, makePlan, updatePlan } from "../tasks/planner";
import { body, origin, type AppEnv } from "./app";

// Tasks, waves and claims (docs/design/backend.md B.9).
export const tasks = new Hono<AppEnv>();

// plan
tasks
  .get("/systems/:id/evolutions/:eid/plan", async (c) => c.json(await getPlan(c.env, c.req.param("id"), c.req.param("eid"))))
  .post("/systems/:id/evolutions/:eid/plan", requireAdmin, async (c) => {
    await assertImportReviewed(c.env, c.req.param("id"));
    return c.json(await makePlan(c.env, c.req.param("id"), c.req.param("eid"), await body(c)), 201);
  })
  .put("/systems/:id/evolutions/:eid/plan", requireAdmin, async (c) => {
    await assertImportReviewed(c.env, c.req.param("id"));
    return c.json(await updatePlan(c.env, c.req.param("id"), c.req.param("eid"), await body(c)));
  });

// tasks: listing is public like /work; claims mint a fork token and a realization secret, so they are admin only.
tasks
  .get("/systems/:id/tasks", async (c) => {
    const q: TasksQuery = {
      ...(c.req.query("status") && { status: c.req.query("status") as TaskStatus }),
      ...(c.req.query("evolution") && { evolution: c.req.query("evolution") }),
    };
    return c.json(await listTasks(c.env, c.req.param("id"), q));
  })
  .get("/systems/:id/tasks/:tid", async (c) => c.json(await taskView(c.env, c.req.param("id"), c.req.param("tid"))))
  .post("/systems/:id/tasks/:tid/claim", requireAdmin, async (c) => {
    await assertImportReviewed(c.env, c.req.param("id"));
    const out = await claimTask(c.env, c.req.param("id"), c.req.param("tid"), await body(c), origin(c));
    return c.json(out.body, out.status);
  })
  .post("/systems/:id/tasks/:tid/release", requireAdmin, async (c) => c.json(await releaseTask(c.env, c.req.param("id"), c.req.param("tid"))));
