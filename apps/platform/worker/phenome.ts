/**
 * Phenome ingest: events a deployed app (or a preview of a realization) reports about itself. The caller proves who it
 * is with a deployment ingest token, a realization secret, or the admin bearer; each event is validated, attributed and
 * stored in the System's DO.
 */
import { PHENOME_LIMITS, PhenomeEventHeader } from "@artyfact/model";
import { outcomeEventContracts, validateOutcomeEvent, type OutcomeEventContract } from "@artyfact/ontology";
import type { PhenomeEventsQuery, PhenomeEventsResponse, PhenomeIngestResponse } from "../shared/api";
import { artifactsFor, withRepo } from "./artifacts/client";
import { bearer, safeEqual } from "./auth";
import { type PhenomePrincipal, type PhenomeRow } from "./do/phenome-store";
import type { HeadState } from "./do/system-authority";
import { badRequest, HttpError, notFound } from "./errors";
import { genomeAt, refreshRegistry, registryStub, systemStub } from "./service";
import { canonicalJson, sha256Hex } from "./util";
import { validateMeasurement } from "./operations/validation";

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

const defaultRefresh = async (env: Env, systemId: string): Promise<void> => { await refreshRegistry(env, systemId); };
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

interface Association {
  thingId: string;
  artifactId: string;
  sourceRepo: string;
  sourceCommit: string;
  genomeCommit: string;
  outputId: string | null;
}

async function realizationGenomeCommit(stub: ReturnType<typeof systemStub>, realizationId: string): Promise<string | undefined> {
  const pinned = await stub.realizationPinnedGenome(realizationId);
  if (pinned) return pinned.commit;
  const rec = await stub.realization(realizationId);
  if (!rec) return undefined;
  const baseHead = rec.realization.baseRevision;
  if (baseHead) {
    const base = await stub.systemCommit(baseHead);
    if (base?.composition?.genomeCommit) {
      const binding = Object.values(base.composition.artifacts ?? {}).find(a => a.repo === rec.baseRepo);
      return binding?.realizedGenome ?? base.composition.genomeCommit;
    }
  }
  return undefined;
}

async function modelOwner(
  env: Env, state: HeadState, genomeCommit: string, artifactId?: string,
): Promise<{ thingId: string; artifactId: string } | null> {
  for (const repo of new Set([state.genomeSource, state.genomeRepo])) {
    try {
      const model = (await genomeAt(env, state.systemId, genomeCommit, repo)).model;
      const matches = model.things.flatMap((thing) => thing.artifacts
        .filter((artifact) => artifactId ? artifact.artifact === artifactId : artifact.type === "worker-fullstack")
        .map((artifact) => ({ thingId: thing.id, artifactId: artifact.artifact })));
      return matches.length === 1 ? matches[0] : null;
    } catch { /* try the canonical import repo for historic Genome revisions */ }
  }
  return null;
}

/** Resolve ownership from stored output/build/deployment/System/candidate records, then confirm the Thing in that Genome. */
async function authoritativeAssociation(env: Env, systemId: string, principal: IngestPrincipal, commit: string): Promise<Association | null> {
  const stub = systemStub(env, systemId);
  const state = await stub.state();
  if (!state) return null;
  if (principal.kind === "deployment" && principal.association) {
    const a = principal.association;
    if (a.source.commit !== commit || a.source.repo !== principal.repo) return null;
    return {
      thingId: a.thingId, artifactId: a.artifactId, sourceRepo: a.source.repo, sourceCommit: a.source.commit,
      genomeCommit: a.genomeCommit, outputId: a.id || null,
    };
  }

  let sourceRepo: string | undefined, genomeCommit: string | undefined, artifactId: string | undefined;
  if (principal.kind === "deployment") {
    sourceRepo = principal.repo;
    if (principal.systemCommit) {
      const sc = await stub.systemCommit(principal.systemCommit);
      const match = Object.entries(sc?.composition?.artifacts ?? {}).find(([, a]) => a.repo === sourceRepo && a.commit === commit);
      genomeCommit = match?.[1].realizedGenome ?? sc?.composition?.genomeCommit;
      artifactId = match?.[0];
    }
    if (!artifactId && principal.realizationId) {
      const rec = await stub.realization(principal.realizationId);
      if (rec?.target === "app" && rec.forkRepo === sourceRepo) { genomeCommit = await realizationGenomeCommit(stub, principal.realizationId); artifactId = await stub.realizationBindingId(principal.realizationId) ?? undefined; }
    }
    if (!artifactId && state.appSource?.repo === sourceRepo && state.appSource.commit === commit) {
      const match = Object.entries(state.manifest?.artifacts ?? {}).find(([, a]) => a.repo === sourceRepo && a.commit === commit);
      genomeCommit = match?.[1].realizedGenome ?? state.genomeCommit;
      artifactId = match?.[0];
    }
    if (!genomeCommit) {
      const candidate = (await stub.candidates()).find((c) => c.commit === commit);
      const rec = candidate ? await stub.realization(candidate.realization) : null;
      if (rec?.target === "app" && rec.forkRepo === sourceRepo) { genomeCommit = await realizationGenomeCommit(stub, rec.realization.id); artifactId = await stub.realizationBindingId(rec.realization.id) ?? undefined; }
    }
  } else if (principal.kind === "realization") {
    const rec = await stub.realization(principal.id);
    if (rec?.target === "app") { sourceRepo = rec.forkRepo; genomeCommit = await realizationGenomeCommit(stub, principal.id); artifactId = await stub.realizationBindingId(principal.id) ?? undefined; }
  } else {
    for (const sc of await stub.history()) {
      const match = Object.entries(sc.composition?.artifacts ?? {}).find(([, a]) => a.commit === commit);
      if (match) { artifactId = match[0]; sourceRepo = match[1].repo; genomeCommit = match[1].realizedGenome ?? sc.composition!.genomeCommit; break; }
    }
    if (!sourceRepo) {
      const candidate = (await stub.candidates()).find((c) => c.commit === commit);
      const rec = candidate ? await stub.realization(candidate.realization) : null;
      if (rec?.target === "app") { sourceRepo = rec.forkRepo; genomeCommit = await realizationGenomeCommit(stub, rec.realization.id); artifactId = await stub.realizationBindingId(rec.realization.id) ?? undefined; }
    }
    if (!sourceRepo && state.appSource?.commit === commit) {
      sourceRepo = state.appSource.repo; const match = Object.entries(state.manifest?.artifacts ?? {}).find(([, a]) => a.repo === sourceRepo && a.commit === commit);
      genomeCommit = match?.[1].realizedGenome ?? state.genomeCommit;
      artifactId = match?.[0];
    }
  }
  if (!sourceRepo || !genomeCommit) return null;
  const owner = await modelOwner(env, state, genomeCommit, artifactId);
  return owner ? { ...owner, sourceRepo, sourceCommit: commit, genomeCommit, outputId: null } : null;
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
  const state = await stub.state();
  if (!state) throw notFound(`system ${systemId} is not imported`);

  const dropped: PhenomeIngestResponse["dropped"] = [];
  const drop = (index: number, reason: string) => void dropped.push({ index, reason });
  let head: string | null | undefined, headLooked = false;
  const staged: { index: number; row: PhenomeRow }[] = [];
  const contracts = new Map<string, OutcomeEventContract[]>();

  for (const [index, raw] of events.entries()) {
    if (enc.encode(JSON.stringify(raw ?? null)).length > PHENOME_LIMITS.eventBytes) { drop(index, "too-large"); continue; }
    const parsed = PhenomeEventHeader.safeParse(raw);
    if (!parsed.success) { drop(index, `invalid: ${parsed.error.issues[0]?.path.join(".") || "event"} ${parsed.error.issues[0]?.message ?? ""}`.trim()); continue; }
    const e = parsed.data;
    if (e.systemId !== systemId) { drop(index, "system-mismatch"); continue; }
    if (e.kind === "measurement") {
      try { validateMeasurement(e.payload); }
      catch (error) { drop(index, `invalid-measurement: ${(error as Error).message}`); continue; }
    }
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
    // A unique stored runtime ID is authoritative. Commit-prefix compatibility is for legacy identities only.
    const matchesDeploymentBuild = (recorded: string | null | undefined) => {
      const legacy = !recorded || (/^[0-9a-f]{7,40}$/.test(recorded) && commit.startsWith(recorded));
      return legacy ? e.buildId.length >= 7 && commit.startsWith(e.buildId) : e.buildId === recorded;
    };
    if (principal.kind === "deployment") {
      if (!matchesDeploymentBuild(principal.buildId)) { drop(index, "build-mismatch"); continue; }
      if (commit.startsWith(e.buildId) && e.buildId.length >= 7) buildId = commit;
    } else if (principal.kind === "realization") {
      if (commit.startsWith(e.buildId) && e.buildId.length >= 7) buildId = commit;
      else { drop(index, "build-mismatch"); continue; }
    }
    let association = await authoritativeAssociation(env, systemId, principal, commit);
    if (!association) { drop(index, "association-unknown"); continue; }
    let deploymentId = principal.kind === "deployment" ? principal.id : e.deploymentId ?? null;
    if (principal.kind !== "deployment" && e.deploymentId) {
      const claimed = await stub.deployment(e.deploymentId);
      if (claimed?.commit === commit && claimed.repo === association.sourceRepo && matchesDeploymentBuild(claimed.buildId)) {
        const output = claimed.output
          ? await stub.realizedArtifact(claimed.output)
          : claimed.build ? await stub.realizedArtifactForBuild(claimed.build) : null;
        if (output) {
          if (output.source.commit !== commit || output.source.repo !== claimed.repo) { drop(index, "association-unknown"); continue; }
          association = {
            thingId: output.thingId, artifactId: output.artifactId, sourceRepo: output.source.repo, sourceCommit: output.source.commit,
            genomeCommit: output.genomeCommit, outputId: output.id || null,
          };
        }
      } else deploymentId = null;
    }
    if (e.thingId !== association.thingId || e.artifactId !== association.artifactId) { drop(index, "artifact-association-mismatch"); continue; }
    if (e.kind === "outcome.event") {
      const event = e.payload as { contractId?: unknown; version?: unknown; payload?: unknown } | null;
      if (!event || typeof event.contractId !== "string" || !Number.isInteger(event.version)) {
        drop(index, "invalid-outcome: contractId and integer version are required"); continue;
      }
      let declared = contracts.get(association.genomeCommit);
      if (!declared) {
        try {
          let model;
          for (const repo of new Set([state.genomeSource, state.genomeRepo])) {
            try { model = (await genomeAt(env, systemId, association.genomeCommit, repo)).model; break; }
            catch { /* historical revisions can live in the original Genome repository */ }
          }
          if (!model) throw new Error("Genome revision unavailable");
          declared = outcomeEventContracts(model.graph);
          contracts.set(association.genomeCommit, declared);
        } catch { drop(index, "outcome-contract-unavailable"); continue; }
      }
      const validation = validateOutcomeEvent(declared, { contractId: event.contractId, version: event.version as number, payload: event.payload });
      if (!validation.valid) { drop(index, `invalid-outcome: ${validation.issues[0]?.message}`); continue; }
    }
    staged.push({
      index,
      row: {
        // Namespaced per principal so one cannot suppress another's events by reusing an id.
        eventId: `${principal.kind === "admin" ? "admin" : `${principal.kind}:${principal.id}`}${EVENT_ID_SEP}${e.id ?? (await sha256Hex(canonicalJson({ ...e, systemId })))}`,
        deploymentId,
        thingId: association.thingId, artifactId: association.artifactId, buildId, commit,
        kind: e.kind, subject: e.subject ?? null, criterion: e.criterion ?? null, emittedAt: e.emittedAt, payload: e.payload,
        realizedArtifactId: association.outputId, genomeCommit: association.genomeCommit, sourceRepo: association.sourceRepo,
      },
    });
  }

  let accepted = 0;
  if (staged.length) {
    const realizationId = principal.kind === "realization" ? principal.id : principal.kind === "deployment" ? principal.realizationId : null;
    const inserted = await stub.phenomeIngest(staged.map((s) => s.row), realizationId, principal.kind !== "deployment");
    staged.forEach((s, i) => (inserted[i] ? accepted++ : drop(s.index, "duplicate")));
    if (accepted) await refreshRegistryThrottled(env, systemId);
  }
  return { accepted, dropped: dropped.sort((a, b) => a.index - b.index) };
}

export async function listEvents(env: Env, systemId: string, query: PhenomeEventsQuery): Promise<PhenomeEventsResponse> {
  return systemStub(env, systemId).phenomeEvents(systemId, query);
}
