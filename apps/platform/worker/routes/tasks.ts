import { Hono } from "hono";
import type { TasksQuery, TaskStatus } from "../../shared/api";
import { requireAdmin } from "../auth";
import { claimTask, listTasks, releaseTask, taskView } from "../service";
import { body, origin, type AppEnv } from "./app";

export const tasks = new Hono<AppEnv>();

// plan (W4): GET/POST/PUT /systems/:id/evolutions/:eid/plan

// tasks (W5): listing is public like /work; claims mint a fork token and a realization secret, so they are admin only.
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
    const out = await claimTask(c.env, c.req.param("id"), c.req.param("tid"), await body(c), origin(c));
    return c.json(out.body, out.status);
  })
  .post("/systems/:id/tasks/:tid/release", requireAdmin, async (c) => c.json(await releaseTask(c.env, c.req.param("id"), c.req.param("tid"))));
