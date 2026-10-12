import { Hono } from "hono";
import type { Env } from "./worker/env";
import { ctxOf, emitPhenome } from "./worker/phenome";
import { contacts } from "./worker/routes/contacts";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => {
  emitPhenome(c.env, "health", { status: "ok" }, ctxOf(c), { minIntervalMs: 60_000 });
  return c.json({ status: "ok", buildId: c.env.BUILD_ID ?? "dev" });
});
app.route("/api/contacts", contacts);

export default app;
