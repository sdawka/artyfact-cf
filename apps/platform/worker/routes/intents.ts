import { Hono } from "hono";
import { requireAdmin } from "../auth";
import { assertImportReviewed } from "../import-review";
import { acceptProposal, createProposal, getProposal, replyProposal } from "../intents";
import { body, origin, type AppEnv } from "./app";

// Intents (docs/design/ontology.md §5). Admin only, like creating an Evolution: a proposal is the first step of a
// Genome change.
export const intents = new Hono<AppEnv>()
  .post("/systems/:id/intents", requireAdmin, async (c) => {
    await assertImportReviewed(c.env, c.req.param("id"));
    return c.json(await createProposal(c.env, c.req.param("id"), await body(c)), 201);
  })
  .get("/systems/:id/intents/:pid", requireAdmin, async (c) => c.json(await getProposal(c.env, c.req.param("id"), c.req.param("pid"))))
  .post("/systems/:id/intents/:pid/reply", requireAdmin, async (c) =>
    c.json(await replyProposal(c.env, c.req.param("id"), c.req.param("pid"), await body(c))))
  .post("/systems/:id/intents/:pid/accept", requireAdmin, async (c) =>
    c.json(await acceptProposal(c.env, c.req.param("id"), c.req.param("pid"), await body(c), origin(c)), 201));
