/**
 * Phenome ingest: events a deployed app (or a preview of a realization) reports about itself. The caller proves who it
 * is with a deployment ingest token, a realization secret, or the admin bearer; each event is validated, attributed and
 * stored in the System's DO.
 */
import { PHENOME_LIMITS, PhenomeEventHeader } from "@artyfact/model";
import type { PhenomeEventsQuery, PhenomeEventsResponse, PhenomeIngestResponse } from "../shared/api";
import { artifactsFor, withRepo } from "./artifacts/client";
import { bearer, safeEqual } from "./auth";
import { type PhenomePrincipal, type PhenomeRow } from "./do/phenome-store";
import { badRequest, HttpError, notFound } from "./errors";
import { registryStub, systemStub } from "./service";
import { canonicalJson, sha256Hex } from "./util";

export type IngestPrincipal = { kind: "admin" } | PhenomePrincipal;

const enc = new TextEncoder();
const EVENT_ID_SEP = "\u001f";
const REFRESH_INTERVAL_MS = 10_000;
const lastRefresh = new Map<string, number>();

/** Test hook: forget when each System's registry summary was last refreshed. */
export function resetPhenomeThrottle(): void {
  lastRefresh.clear();
  refresh = defaultRefresh;
}

async function defaultRefresh(env: Env, systemId: string): Promise<void> {
  const summary = await systemStub(env, systemId).summary();
  if (summary) await registryStub(env).registerSystem(summary);
}
let refresh: (env: Env, systemId: string) => Promise<void> = defaultRefresh;
/** Test hook: replace the registry refresh (undone by {@link resetPhenomeThrottle}). */
export function setPhenomeRefresh(fn: (env: Env, systemId: string) => Promise<void>): void {
  refresh = fn;
}

/** 401 without a bearer token, 403 when it matches nothing. The admin bearer is compared in constant time. */
export async function ingestPrincipal(env: Env, systemId: string, authorization: string | undefined): Promise<IngestPrincipal> {
  const token = bearer(authorization);
  if (!token) throw new HttpError(401, "unauthorized", "ingest token, realization secret or admin bearer required");
  // Unknown ids are refused before their Durable Object is touched, so a bearer cannot conjure objects.
  if (!(await registryStub(env).hasSystem(systemId))) throw notFound(`system ${systemId} is not imported`);
  if (env.ADMIN_TOKEN && (await safeEqual(token, env.ADMIN_TOKEN))) return { kind: "admin" };
  const principal = await systemStub(env, systemId).phenomePrincipal(await sha256Hex(token));
  if (!principal) throw new HttpError(403, "forbidden", "ingest token does not match");
  return principal;
}

/** The fork's current head, read only when an event names a commit no candidate has. */
async function forkHead(env: Env, systemId: string, realizationId: string): Promise<string | null> {
  const rec = await systemStub(env, systemId).realization(realizationId);
  if (!rec) return null;
  try {
    const [head] = await withRepo(artifactsFor(env), rec.forkRepo, (r) => r.log({ limit: 1 }));
    return head?.hash ?? null;
  } catch {
    return null;
  }
}

/**
 * Refresh the registry summary at most once per 10 s per System (ingest can be chatty). The throttle is per isolate,
 * so the real bound is one refresh per isolate per 10 s, and the last events of a burst are only reflected by the next
 * refresh. A failed refresh is logged and never fails an ingest that already committed.
 */
async function refreshRegistryThrottled(env: Env, systemId: string): Promise<void> {
  const now = Date.now();
  if (now - (lastRefresh.get(systemId) ?? 0) < REFRESH_INTERVAL_MS) return;
  lastRefresh.set(systemId, now);
  try {
    await refresh(env, systemId);
  } catch (e) {
    lastRefresh.delete(systemId);
    console.error("phenome: registry refresh failed", e);
  }
}

export async function ingestEvents(env: Env, systemId: string, principal: IngestPrincipal, body: unknown): Promise<PhenomeIngestResponse> {
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) throw badRequest("body must be {events: PhenomeEventHeader[]}");
  if (events.length > PHENOME_LIMITS.eventsPerRequest) throw badRequest(`at most ${PHENOME_LIMITS.eventsPerRequest} events per request`);
  const stub = systemStub(env, systemId);
  if (!(await stub.state())) throw notFound(`system ${systemId} is not imported`);

  const dropped: PhenomeIngestResponse["dropped"] = [];
  const drop = (index: number, reason: string) => void dropped.push({ index, reason });
  let head: string | null | undefined, headLooked = false;
  const staged: { index: number; row: PhenomeRow }[] = [];

  for (const [index, raw] of events.entries()) {
    if (enc.encode(JSON.stringify(raw ?? null)).length > PHENOME_LIMITS.eventBytes) { drop(index, "too-large"); continue; }
    const parsed = PhenomeEventHeader.safeParse(raw);
    if (!parsed.success) { drop(index, `invalid: ${parsed.error.issues[0]?.path.join(".") || "event"} ${parsed.error.issues[0]?.message ?? ""}`.trim()); continue; }
    const e = parsed.data;
    if (e.systemId !== systemId) { drop(index, "system-mismatch"); continue; }
    // Resolve the emitted commit to one full hash; only that hash is stored and looked up, never the short form.
    let commit = e.commit;
    if (principal.kind === "deployment") {
      if (e.deploymentId && e.deploymentId !== principal.id) { drop(index, "deployment-mismatch"); continue; }
      if (!principal.commit.startsWith(e.commit)) { drop(index, "commit-mismatch"); continue; }
      commit = principal.commit;
    } else if (principal.kind === "realization") {
      let full = principal.commits.find((c) => c.startsWith(e.commit));
      if (!full) {
        if (!headLooked) { headLooked = true; head = await forkHead(env, systemId, principal.id); }
        if (head?.startsWith(e.commit)) full = head;
      }
      if (!full) { drop(index, "commit-not-in-realization"); continue; }
      commit = full;
    }
    let buildId = e.buildId;
    if (principal.kind !== "admin") {
      // The build id is the commit (or, for a deployment, the id the platform recorded); anything else would split versions.
      if (commit.startsWith(e.buildId) && e.buildId.length >= 7) buildId = commit;
      else if (principal.kind === "deployment" && principal.buildId && e.buildId === principal.buildId) buildId = e.buildId;
      else { drop(index, "build-mismatch"); continue; }
    }
    staged.push({
      index,
      row: {
        // Namespaced per principal so one cannot suppress another's events by reusing an id.
        eventId: `${principal.kind === "admin" ? "admin" : `${principal.kind}:${principal.id}`}${EVENT_ID_SEP}${e.id ?? (await sha256Hex(canonicalJson({ ...e, systemId })))}`,
        deploymentId: principal.kind === "deployment" ? principal.id : e.deploymentId ?? null,
        // thingId and artifactId are recorded as the emitter states them; the model at that commit is not consulted.
        thingId: e.thingId, artifactId: e.artifactId, buildId, commit,
        kind: e.kind, subject: e.subject ?? null, criterion: e.criterion ?? null, emittedAt: e.emittedAt, payload: e.payload,
      },
    });
  }

  let accepted = 0;
  if (staged.length) {
    const realizationId = principal.kind === "realization" ? principal.id : principal.kind === "deployment" ? principal.realizationId : null;
    const inserted = await stub.phenomeIngest(staged.map((s) => s.row), realizationId, principal.kind === "realization");
    staged.forEach((s, i) => (inserted[i] ? accepted++ : drop(s.index, "duplicate")));
    if (accepted) await refreshRegistryThrottled(env, systemId);
  }
  return { accepted, dropped: dropped.sort((a, b) => a.index - b.index) };
}

export async function listEvents(env: Env, systemId: string, query: PhenomeEventsQuery): Promise<PhenomeEventsResponse> {
  return systemStub(env, systemId).phenomeEvents(systemId, query);
}
