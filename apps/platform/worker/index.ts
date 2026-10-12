import { Hono } from "hono";
import type { HealthResponse } from "../shared/api";
import { SystemAuthority } from "./do/system-authority";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) =>
  c.json<HealthResponse>({ status: "ok", service: "artyfact-platform", time: new Date().toISOString() }),
);

export { SystemAuthority };

export default {
  fetch: app.fetch,
  // Stub: acknowledge Artifacts events until the consumer is implemented.
  async queue(batch: MessageBatch): Promise<void> {
    batch.ackAll();
  },
} satisfies ExportedHandler<Env>;
