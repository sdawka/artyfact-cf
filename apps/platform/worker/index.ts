import { Hono } from "hono";
import type { ApiError, HealthResponse } from "../shared/api";
import { ArtifactsUnavailableError, artifactsErrorCode } from "./artifacts/client";
import { SystemAuthority } from "./do/system-authority";
import { fromRpc, HttpError } from "./errors";
import type { QueueContext } from "./hooks/contract";
import { queueHandler } from "./hooks/index";
import type { AppEnv } from "./routes/app";
import { evaluations } from "./routes/evaluations";
import { events } from "./routes/events";
import { evolutions } from "./routes/evolutions";
import { history } from "./routes/history";
import { realizations } from "./routes/realizations";
import { systems } from "./routes/systems";
import { registryStub, submit, systemForRealization, systemStub } from "./service";

const app = new Hono<AppEnv>();

app.get("/api/health", (c) =>
  c.json<HealthResponse>({ status: "ok", service: "artyfact-platform", time: new Date().toISOString() }),
);
app.route("/api", systems);
app.route("/api", evolutions);
app.route("/api", realizations);
app.route("/api", evaluations);
app.route("/api", history);
app.route("/api", events);

const ARTIFACTS_STATUS: Record<string, 404 | 409 | 422 | 503> = {
  NOT_FOUND: 404, ALREADY_EXISTS: 409, FORK_IN_PROGRESS: 409, INVALID_INPUT: 422, INVALID_REPO_NAME: 422, UPSTREAM_UNAVAILABLE: 503,
};

app.onError((err, c) => {
  const e = err instanceof HttpError ? err : fromRpc(err);
  if (e) return c.json<ApiError>({ error: { code: e.code, message: e.message, ...(e.details !== undefined && { details: e.details }) } }, e.status);
  if (err instanceof ArtifactsUnavailableError) return c.json<ApiError>({ error: { code: "artifacts-unavailable", message: err.message } }, 503);
  const code = artifactsErrorCode(err);
  if (code && ARTIFACTS_STATUS[code]) return c.json<ApiError>({ error: { code: `artifacts-${code.toLowerCase().replaceAll("_", "-")}`, message: err.message } }, ARTIFACTS_STATUS[code]);
  if ((err as Error).name === "ModelParseError") return c.json<ApiError>({ error: { code: "invalid-genome", message: err.message } }, 422);
  // Never log request bodies or headers (tokens); the message is enough to debug.
  console.error(`unhandled ${c.req.method} ${new URL(c.req.url).pathname}: ${(err as Error).message}`);
  return c.json<ApiError>({ error: { code: "internal", message: "internal error" } }, 500);
});

app.notFound((c) => c.json<ApiError>({ error: { code: "not-found", message: `no route ${c.req.method} ${new URL(c.req.url).pathname}` } }, 404));

function queueContext(env: Env): QueueContext {
  return {
    env,
    resolveFork: (repo) => registryStub(env).resolveFork(repo),
    submit: async (rid, commit, source, systemId) => submit(env, systemId ?? (await systemForRealization(env, rid)), rid, { commit }, source),
    markEventSeen: (id, systemId) => (systemId ? systemStub(env, systemId) : registryStub(env)).markEventSeen(id),
  };
}

export { SystemAuthority };
export { app };

export default {
  fetch: app.fetch,
  /** Artifacts push events (`cf.artifacts.repo.pushed`): delegated to the hooks slice's consumer. */
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await queueHandler(batch, queueContext(env));
  },
} satisfies ExportedHandler<Env>;
