import { Hono, type MiddlewareHandler } from "hono";
import type { ApiError, HealthResponse } from "../shared/api";
import { ArtifactsUnavailableError, artifactsErrorCode } from "./artifacts/client";
import { SystemAuthority } from "./do/system-authority";
import { queueEntry } from "./hooks/index";
import { fromRpc, HttpError, notFound } from "./errors";
import { registryStub } from "./service";
import type { AppEnv } from "./routes/app";
import { builds } from "./routes/builds";
import { changelog } from "./routes/changelog";
import { editor } from "./routes/editor";
import { evaluations } from "./routes/evaluations";
import { events } from "./routes/events";
import { evolutions } from "./routes/evolutions";
import { history } from "./routes/history";
import { intents } from "./routes/intents";
import { phenome } from "./routes/phenome";
import { realizations } from "./routes/realizations";
import { systems } from "./routes/systems";
import { parts } from "./routes/parts";
import { templateUpgrade } from "./routes/template-upgrade";

const app = new Hono<AppEnv>();

app.get("/api/health", (c) =>
  c.json<HealthResponse>({ status: "ok", service: "artyfact-platform", time: new Date().toISOString() }),
);
// Reads of a System the registry does not know are 404 before its Durable Object is instantiated (no schema write,
// no Artifacts reads for an arbitrary id).
const knownSystem: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.param("id") ?? "";
  if (!(await registryStub(c.env).hasSystem(id))) throw notFound(`system ${id} is not imported`);
  await next();
};
app.get("/api/systems/:id", knownSystem);
app.get("/api/systems/:id/*", knownSystem);
app.route("/api", systems);
app.route("/api", parts);
app.route("/api", evolutions);
app.route("/api", realizations);
app.route("/api", evaluations);
app.route("/api", history);
app.route("/api", events);
app.route("/api", editor);
app.route("/api", changelog);
app.route("/api", builds);
app.route("/api", phenome);
app.route("/api", templateUpgrade);
app.route("/api", intents);

const ARTIFACTS_STATUS: Record<string, 404 | 409 | 422 | 503> = {
  NOT_FOUND: 404, ALREADY_EXISTS: 409, FORK_IN_PROGRESS: 409, INVALID_INPUT: 422, INVALID_REPO_NAME: 422, UPSTREAM_UNAVAILABLE: 503,
};

/** A Worker on new code calling a Durable Object instance still running the previous version (deploy skew). */
export const isVersionSkew = (err: unknown) => /does not implement (the )?method/i.test((err as Error)?.message ?? "");

app.onError((err, c) => {
  if (isVersionSkew(err)) {
    c.header("Retry-After", "5");
    return c.json<ApiError>({ error: { code: "version-skew", message: "the platform is updating; retry shortly" } }, 503);
  }
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

export { SystemAuthority };
export { app };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // FAKE_ARTIFACTS=1: in-memory Artifacts seeded with examples/ (local demos and e2e; never set when deployed).
    if (env.FAKE_ARTIFACTS === "1") await (await import("./artifacts/fake-platform")).ensureFakePlatform(env);
    return app.fetch(request, env, ctx);
  },
  /** Artifacts push events (`cf.artifacts.repo.pushed`): delegated to the hooks slice's consumer. */
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    await queueEntry(batch, env);
  },
} satisfies ExportedHandler<Env>;
