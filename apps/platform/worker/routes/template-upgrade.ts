import { Hono } from "hono";
import { requireAdmin } from "../auth";
import { applyTemplateUpgrade, templateUpgradePlan } from "../template-upgrade";
import { body, origin, type AppEnv } from "./app";
import { requireImportReviewed as reviewed } from "./import-review";

/**
 * App template upgrades: the plan at a ref (public read), and applying it as a new candidate (admin, after the
 * System's import review).
 */
export const templateUpgrade = new Hono<AppEnv>()
  .get("/systems/:id/template-upgrade", async (c) => c.json(await templateUpgradePlan(c.env, c.req.param("id"), c.req.query("ref") || "head")))
  .post("/systems/:id/template-upgrade", requireAdmin, reviewed, async (c) =>
    c.json(await applyTemplateUpgrade(c.env, c.req.param("id"), await body(c), origin(c)), 201));
