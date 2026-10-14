import { Hono } from "hono";
import {
  INTEGRITY_MAX_CALLS, type IntegrityAgreementRequest, type IntegrityPreviewRequest,
  type IntegrityProviderChoice, type IntegrityRunRequest,
} from "../../shared/integrity";
import { requireAdmin } from "../auth";
import { badRequest, fromRpc, HttpError, notFound } from "../errors";
import { isOntologySystemId } from "../ontology-packages/store";
import { systemStub } from "../service";
import { artifactsFor, withRepo } from "../artifacts/client";
import { readGenomeSourceFiles } from "../artifacts/genome-source";
import type { AppEnv, Ctx } from "./app";

const PROVIDERS = new Set<IntegrityProviderChoice>(["auto", "clef", "jev", "openrouter", "off"]);
async function body(c: Ctx, limit = 1_400_000): Promise<Record<string, unknown>> {
  const reader = c.req.raw.body?.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) for (;;) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.length;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, "integrity-too-large", "integrity request exceeds size limit"); }
    chunks.push(next.value);
  }
  try {
    const parsed = JSON.parse(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).text());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw badRequest("body must be a JSON object"); }
}
async function destination(c: Ctx) {
  const id = c.req.param("id");
  if (!isOntologySystemId(id)) throw badRequest("invalid or reserved System id");
  const stub = systemStub(c.env, id);
  if (!(await stub.ontologyInitial()) && !(await stub.state())) throw notFound("System import destination not found");
  return { id, stub };
}
async function rpc<T>(value: Promise<T>): Promise<T> { try { return await value; } catch (error) { throw fromRpc(error) ?? error; } }

function files(input: Record<string, unknown>): Record<string, string> {
  const value = input.files;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("files must be a path-to-text object");
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([path, text]) => !path || typeof text !== "string")) throw badRequest("files must be a non-empty path-to-text object");
  return Object.fromEntries(entries) as Record<string, string>;
}
function runRequest(input: Record<string, unknown>): IntegrityRunRequest {
  if (input.snapshotId !== undefined && (typeof input.snapshotId !== "string" || !input.snapshotId.startsWith("snapshot."))) throw badRequest("snapshotId must be a snapshot id");
  const provider = input.provider ?? "auto";
  if (typeof provider !== "string" || !PROVIDERS.has(provider as IntegrityProviderChoice)) throw badRequest("unsupported integrity provider");
  if (input.model !== undefined && (typeof input.model !== "string" || input.model.length > 200)) throw badRequest("model must be at most 200 characters");
  if (input.model !== undefined && !["clef", "jev", "openrouter"].includes(provider)) throw badRequest("model requires an explicit clef, jev or openrouter provider");
  const rawBudget = input.budget;
  if (rawBudget !== undefined && (!rawBudget || typeof rawBudget !== "object" || Array.isArray(rawBudget))) throw badRequest("budget must be an object");
  const maxCalls = (rawBudget as { maxCalls?: unknown } | undefined)?.maxCalls;
  if (maxCalls !== undefined && (!Number.isInteger(maxCalls) || Number(maxCalls) < 1 || Number(maxCalls) > INTEGRITY_MAX_CALLS)) {
    throw badRequest(`budget.maxCalls must be an integer from 1 to ${INTEGRITY_MAX_CALLS}`);
  }
  const rawThresholds = input.thresholds;
  if (rawThresholds !== undefined && (!rawThresholds || typeof rawThresholds !== "object" || Array.isArray(rawThresholds))) throw badRequest("thresholds must be an object");
  const confident = (rawThresholds as { confident?: unknown } | undefined)?.confident;
  const review = (rawThresholds as { review?: unknown } | undefined)?.review;
  if ([confident, review].some((value) => value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1))) {
    throw badRequest("thresholds must be finite numbers from 0 to 1");
  }
  const effectiveConfident = confident === undefined ? 0.9 : confident as number;
  const effectiveReview = review === undefined ? 0.5 : review as number;
  if (effectiveReview > effectiveConfident) throw badRequest("thresholds.review must not exceed thresholds.confident");
  return {
    ...(input.snapshotId !== undefined && { snapshotId: input.snapshotId as string }), provider: provider as IntegrityProviderChoice,
    ...(input.model !== undefined && { model: input.model as string }),
    ...(rawThresholds !== undefined && { thresholds: { ...(confident !== undefined && { confident: confident as number }), ...(review !== undefined && { review: review as number }) } }),
    ...(maxCalls !== undefined && { budget: { maxCalls: Number(maxCalls) } }),
    ...(input.rerun === true && { rerun: true }),
  };
}

export const integrity = new Hono<AppEnv>()
  .post("/systems/:id/integrity/preview", requireAdmin, async (c) => {
    const { id, stub } = await destination(c);
    const input = await body(c) as unknown as IntegrityPreviewRequest;
    return c.json({ snapshot: await rpc(stub.integrityPreview(id, files(input as unknown as Record<string, unknown>))) }, 201);
  })
  .post("/systems/:id/integrity/runs", requireAdmin, async (c) => {
    const { id, stub } = await destination(c);
    const request = runRequest(await body(c));
    if (!request.snapshotId) {
      const state = await rpc(stub.state());
      if (!state) throw badRequest("snapshotId is required before the System has an imported Genome");
      const loaded = await withRepo(artifactsFor(c.env), state.genomeSource, (repo) => readGenomeSourceFiles(repo, state.genomeCommit));
      request.snapshotId = (await rpc(stub.integrityPreview(id, Object.fromEntries(loaded), "imported"))).id;
      await rpc(stub.integrityLinkSource(state.genomeCommit, request.snapshotId));
    }
    return c.json({ run: await rpc(stub.integrityStart(request)) }, 202);
  })
  .get("/systems/:id/integrity/runs", requireAdmin, async (c) => {
    const { stub } = await destination(c);
    const limit = Number(c.req.query("limit") ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badRequest("limit must be an integer from 1 to 100");
    return c.json({ runs: await rpc(stub.integrityRuns(limit)) });
  })
  .get("/systems/:id/integrity/runs/:runId", requireAdmin, async (c) => {
    const { stub } = await destination(c);
    const run = await rpc(stub.integrityRun(c.req.param("runId")));
    if (!run) throw notFound("integrity run not found");
    return c.json({ run });
  })
  .post("/systems/:id/integrity/runs/:runId/cancel", requireAdmin, async (c) => {
    const { stub } = await destination(c);
    return c.json({ run: await rpc(stub.integrityCancel(c.req.param("runId"))) });
  })
  .post("/systems/:id/integrity/runs/:runId/agreement", requireAdmin, async (c) => {
    const { stub } = await destination(c), input = await body(c, 256_000);
    if (!Array.isArray(input.dispositions) || input.dispositions.length > 1000) throw badRequest("dispositions must be a bounded array");
    for (const d of input.dispositions) {
      if (!d || typeof d !== "object" || typeof d.findingId !== "string" || !["accepted", "rejected", "repaired", "deferred"].includes(String(d.decision))
        || typeof d.rationale !== "string" || !d.rationale.trim() || d.rationale.length > 4000) throw badRequest("each disposition requires a findingId, decision and rationale");
    }
    return c.json({ run: await rpc(stub.integrityAgree(c.req.param("runId"), input as unknown as IntegrityAgreementRequest)) });
  });
