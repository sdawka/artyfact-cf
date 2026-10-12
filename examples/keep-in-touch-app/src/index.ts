import { Hono } from "hono";
import type { Env } from "./worker/env";
import { contacts } from "./worker/routes/contacts";

const app = new Hono<{ Bindings: Env }>();

app.get("/health", (c) => c.json({ status: "ok", buildId: c.env.BUILD_ID ?? "dev" }));
app.route("/api/contacts", contacts);

export default app;
