import { Hono } from "hono";
import type { BuildReporter, BuildReportResponse, BuildsResponse, DeploymentCreated, DeploymentsResponse, IngestTokenResponse } from "../../shared/api";
import { requireAdmin, requireRealizationSecret } from "../auth";
import { buildsView, createDeployment, deploymentsView, reportBuild, rotateIngestToken } from "../deployments";
import { HttpError } from "../errors";
import { systemStub } from "../service";
import { sha256Hex } from "../util";
import { body, type AppEnv, type Ctx } from "./app";

const bearer = (c: Ctx) => /^Bearer\s+(.+)$/i.exec(c.req.header("authorization") ?? "")?.[1].trim();

/** Constant-time match of the bearer against `CI_REPORT_TOKEN` (false when the secret is unset). */
async function isCi(c: Ctx): Promise<boolean> {
  const token = bearer(c);
  const expected = c.env.CI_REPORT_TOKEN;
  if (!token || !expected) return false;
  const [a, b] = await Promise.all([sha256Hex(token), sha256Hex(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Realization build routes: the CI token, the admin bearer, or this realization's secret (401 without a bearer, else 403). */
async function realizationReporter(c: Ctx): Promise<BuildReporter> {
  if (await isCi(c)) return "ci";
  const id = c.req.param("id")!, rid = c.req.param("rid")!;
  const who = await requireRealizationSecret(c.env, c.req.header("authorization"), async () => [{ systemId: id, hash: await systemStub(c.env, id).realizationSecretHash(rid) }]);
  return who.admin ? "admin" : "agent";
}

/** System build reports (production): the CI token or the admin bearer. */
async function systemReporter(c: Ctx): Promise<BuildReporter> {
  if (await isCi(c)) return "ci";
  let admin = false;
  await requireAdmin(c, async () => { admin = true; });
  if (!admin) throw new HttpError(403, "forbidden", "CI or admin bearer token required");
  return "admin";
}

export const builds = new Hono<AppEnv>()
  .get("/systems/:id/realizations/:rid/builds", async (c) => {
    await realizationReporter(c);
    return c.json<BuildsResponse>({ builds: await systemStub(c.env, c.req.param("id")).builds({ realization: c.req.param("rid") }) });
  })
  .post("/systems/:id/realizations/:rid/builds", async (c) => {
    const reporter = await realizationReporter(c);
    return c.json<BuildReportResponse>(await reportBuild(c.env, c.req.param("id"), c.req.param("rid"), await body(c), reporter));
  })
  .get("/systems/:id/builds", async (c) =>
    c.json<BuildsResponse>(await buildsView(c.env, c.req.param("id"), {
      ...(c.req.query("commit") && { commit: c.req.query("commit") }), ...(c.req.query("kind") && { kind: c.req.query("kind") }),
      ...(c.req.query("realization") && { realization: c.req.query("realization") }),
    })))
  .post("/systems/:id/builds", async (c) => {
    const reporter = await systemReporter(c);
    return c.json<BuildReportResponse>(await reportBuild(c.env, c.req.param("id"), null, await body(c), reporter));
  })
  .get("/systems/:id/deployments", async (c) => c.json<DeploymentsResponse>(await deploymentsView(c.env, c.req.param("id"))))
  .post("/systems/:id/deployments", requireAdmin, async (c) => c.json<DeploymentCreated>(await createDeployment(c.env, c.req.param("id"), await body(c)), 201))
  .post("/systems/:id/deployments/:did/ingest-token", requireAdmin, async (c) =>
    c.json<IngestTokenResponse>(await rotateIngestToken(c.env, c.req.param("id"), c.req.param("did"))));
