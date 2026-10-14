import { LifecycleStore, type ClaimReservation } from './lifecycle-store';
import type { RealizationPlan, TaskClaimRequest, IntegratedBinding } from '../../shared/lifecycle';
import type { TaskDefinition } from '@artyfact/model';
import { acceptedTemplateResolver, OntologyPackagesStore } from '../ontology-packages/store';
import type { OntologyImportPreviewRequest } from '../../shared/ontology-packages';
import { OperationsAuditStore } from '../operations/audit-store';
import type { OperationAuditEntry } from '../../shared/operations';
import { DurableObject } from "cloudflare:workers";
import type { GateCriterion } from "../promotion";
import type { EvidenceImageRef } from "../hooks/contract";
import type {
  ArtifactBinding, PartScope, PartRecord, PartSummary, RealizedArtifact, Build, BuildKind, BuildSummary, Candidate, Deployment, Checkpoint, ConflictReport, Evaluation, GateItem, Evolution, EvolutionState, PhenomeEventsQuery, PhenomeEventsResponse, PlatformRef, Proposal, Realization, RealizationOrigin, RealizationStatus, ScaffoldSource, Signifier, SseEnvelope, SseEvent,
  SystemCommit, SystemManifest, SystemSummary, TaskPacket, WorkResponse,
  ProposalDecisions, ProposalPlanNode, SystemImportReview, SystemImportReviewStatus,
} from "../../shared/api";
import { ImportReviewStore } from "./import-review-store";
import { ProposalPlanStore, type StoredProposalPlan } from "./proposal-plan-store";
import { planCounts } from "./plan-summary";
import { forkName } from "@artyfact/cli/naming";
import { canonicalJson, evolutionShort, nowIso, sha256Hex } from "../util";
import { ProposalsStore, type AcceptedIds, type ClaimResult, type ProposalTurn, type ReviseResult, type StoredProposal } from "./proposals-store";
import { BuildsStore, type BuildUpsert, type BuildsSummaryPart, type DeploymentInput } from "./builds-store";
import { PhenomeStore, type PhenomePrincipal, type PhenomeRow } from "./phenome-store";
import { ChangelogStore, type CachedChangelog } from "./changelog-store";
import { RegistryStore } from "./registry";
import { PartsStore } from "../parts/store";
import type { schema } from "@artyfact/model";
import { applySchema } from "./schema";
import { isBlocking } from "../../shared/verdict";

/** Name of the DO instance holding the System registry and the realization/fork index. */
export const REGISTRY = "__registry";

/** A hooks ConflictReport as stored (plain JSON). */
export type StoredConflict = ConflictReport & { nodes?: string[]; paths?: string[]; error?: string };

export class StaleBaseError extends Error {
  constructor(readonly currentHead: string | null) {
    super(`stale base: System head is ${currentHead ?? "unset"}`);
    this.name = "StaleBaseError";
  }
}

/** @deprecated name kept for callers: a hard {@link GateItem}. */
export type BlockingCriterion = GateItem;

/** Refusal: hard items block; advisories only refuse when the rationale is empty. */
export class PromotionBlockedError extends Error {
  constructor(readonly code: "blocked" | "advisories-unacknowledged", readonly blocking: GateItem[], readonly advisories: GateItem[]) {
    super(code === "blocked" ? `promotion blocked by ${blocking.length} hard criteria` : "advisories must be acknowledged with a rationale");
    this.name = "PromotionBlockedError";
  }
}

export type { GateCriterion, GateItem };

/** The promotion gate cannot be established; promotion is refused (fail closed). */
export class GateUnavailableError extends Error {
  constructor(readonly reason: string) {
    super(`promotion gate unavailable: ${reason}`);
    this.name = "GateUnavailableError";
  }
}

/** Genome candidates go through accept (interpretation, Evolution reseed, the candidate Genome's provenance), never /promote. */
export class UseAcceptError extends Error {
  constructor(readonly candidates: string[]) {
    super(`${candidates.join(", ")} ${candidates.length === 1 ? "is a Genome candidate" : "are Genome candidates"}; accept Genome amendments with POST /api/systems/:id/evolutions/:eid/accept`);
    this.name = "UseAcceptError";
  }
}

/** The candidate an accept names is no longer the realization's latest (a newer commit was submitted). */
export class StaleCandidateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleCandidateError";
  }
}

/** Thrown by RPC methods; the `[code]` message prefix survives RPC so the Worker can map it to HTTP. */
export class ConflictError extends Error {
  constructor(readonly code: "not-found" | "invalid-state", readonly detail: string) {
    super(`[${code}] ${detail}`);
    this.name = "ConflictError";
  }
}

/** `reserveRealization` refused an `expectedBase` the canonical commit no longer is; maps to a 409 `stale-base`. */
export class StaleBaseRefusal extends Error {
  constructor(readonly detail: string) {
    super(`[stale-base] ${detail}`);
    this.name = "StaleBaseRefusal";
  }
}

/** The model's Evolution as stored (`scope_json`). */
export interface EvolutionSeed {
  id: string;
  title: string;
  intent: string;
  state: EvolutionState;
  kind: Evolution["kind"];
  affectedNodes: string[];
  affectedClaims: string[];
  genomeDelta: Evolution["genomeDelta"];
  acceptanceCriteria: string[];
  requiredEvidence: string[];
  dependsOn: string[];
  risk: Evolution["risk"];
  baseRevision?: string;
}

export interface ManifestExtras {
  /** Artifact id of the app (e.g. `artifact.webapp`). */
  artifactId: string;
  templateVersions: Record<string, string>;
  hookVersions: Record<string, string>;
  /** Set on import; later commits carry the head's recorded `platform`. */
  platform?: PlatformRef | null;
}

export interface BootstrapInput extends ManifestExtras {
  systemId: string;
  title: string;
  phase?: string;
  genomeRepo: string;
  appRepo: string;
  genomeCommit: string;
  appCommit: string | null;
  artifactBindings?: Record<string, ArtifactBinding>;
  platform: PlatformRef | null;
  scaffoldFrom?: ScaffoldSource;
  evolutions: EvolutionSeed[];
  /** Re-point an existing System at different repos/commits (admin). Without it that is `[already-imported]`. */
  force?: boolean;
}

export interface HeadState {
  systemId: string;
  title: string;
  phase?: string;
  head: string | null;
  genomeRepo: string;
  appRepo: string;
  genomeCommit: string;
  /** Repo the canonical Genome currently lives in (an accepted fork after an amendment). */
  genomeSource: string;
  /** Repo + commit of the canonical app (the promoted fork after a promotion). */
  appSource: { repo: string; commit: string } | null;
  /** `platform` repo commit recorded at import (null when absent or imported before 2.7). */
  platform: PlatformRef | null;
  manifest: SystemManifest | null;
}

export interface ReserveInput {
  evolutionId: string;
  target: "app" | "genome";
  agentLabel?: string;
  role?: Realization["agent"]["role"];
  /** B5: who drives the realization (stored in `realizations.origin`). */
  origin?: RealizationOrigin;
  /** Refuse with `[stale-base]` unless the base (the canonical Genome or app commit) is this commit. */
  expectedBase?: string;
}

export interface ReservedRealization {
  realization: Realization;
  /** Repo to fork from and its commit, and the fork name to create. */
  baseRepo: string;
  baseCommit: string;
  forkRepo: string;
}

export interface RealizationRecord {
  realization: Realization;
  packet: TaskPacket | null;
  packetHash: string | null;
  target: "app" | "genome";
  forkRepo: string;
  baseRepo: string;
  baseCommit: string;
  evolutionId: string;
  /** Id (never the secret) of the fork's write token, if one was minted. */
  tokenId: string | null;
}

export interface CandidateInput {
  realizationId: string;
  commit: string;
  manifest: Record<string, unknown>;
  changedPaths: string[];
  changedNodes: string[];
}

export interface PromoteInput extends ManifestExtras {
  candidateIds: string[];
  expectedHead: string | null;
  rationale: string;
  by: string;
  /**
   * candidate id → gate criteria computed by the Worker (see ../promotion.ts). A candidate without an entry is refused
   * (`gate-unavailable`); the Evolution's acceptance criteria are added from the DO's own record regardless.
   */
  gates: Record<string, GateCriterion[]>;
}

/** Credentials of a realization that promotion or acceptance ended: its secret is already nulled; the Worker revokes the token. */
export interface EndedCredential { realizationId: string; forkRepo: string; tokenId: string | null }

export type PromoteResult =
  | { ok: true; commit: SystemCommit; rejected: string[]; advisories: GateItem[]; ended: EndedCredential[] }
  | { ok: false; code: "stale-base"; currentHead: string | null }
  | { ok: false; code: "blocked" | "advisories-unacknowledged"; blocking: GateItem[]; advisories: GateItem[] }
  | { ok: false; code: ConflictError["code"] | "gate-unavailable" | "use-accept"; message: string };

export interface AcceptInput extends ManifestExtras {
  realizationId: string;
  /** The candidate the admin reviewed and its commit: accept refuses `stale-candidate` unless it is still the realization's latest. */
  candidateId: string;
  commit: string;
  rationale: string;
  by: string;
  evolutions: EvolutionSeed[];
  /** Gate criteria the Worker computed for `candidateId` (the same gate as promotion). */
  gates?: GateCriterion[];
}

export type AcceptResult =
  | { ok: true; commit: SystemCommit; realization: Realization; genomeCommit: string; advisories: GateItem[]; ended: EndedCredential[] }
  | { ok: false; code: "not-found" | "invalid-state" | "stale-base" | "stale-candidate" | "gate-unavailable"; message: string }
  | { ok: false; code: "blocked" | "advisories-unacknowledged"; blocking: GateItem[]; advisories: GateItem[] };

export interface PreparedCommit { head: string | null; manifest: SystemManifest; manifestHash: string }

type Row = Record<string, SqlStorageValue>;
const str = (v: SqlStorageValue | undefined) => (v == null ? null : String(v));
const json = <T>(v: SqlStorageValue | undefined, fallback: T): T => (v == null || v === "" ? fallback : (JSON.parse(String(v)) as T));



const OPEN_CANDIDATE = ["submitted", "evaluated", "selected"];
export const TERMINAL_REALIZATION: RealizationStatus[] = ["promoted", "rejected", "abandoned"];
const PING_MS = 15_000;
/**
 * Each SSE stream is closed after this long. A held stream keeps this instance (and its code version) alive across a
 * deploy, so new Worker code would call an old object; EventSource reconnects by itself (`retry: 3000`).
 */
let sseLifetimeMs = 5 * 60_000;
/** Test hook: change the SSE stream lifetime (undefined restores 5 minutes). */
export function setSseLifetime(ms: number | undefined): void {
  sseLifetimeMs = ms ?? 5 * 60_000;
}
const enc = new TextEncoder();

/** One instance per System: canonical state, realizations, candidates, evaluations and promotion (CAS). */
/**
 * Bump when what the model loader derives from a commit changes: `model` and `rules` parts stored under another version
 * are ignored and rebuilt from the files. `files` are the commit's raw text and are not versioned.
 * 2: the Genome v2 projection (a v1 commit no longer loads).
 * 3: the serialized model carries `views` and intent nodes their containment `parent`.
 */
export const MODEL_CACHE_VERSION = 3;
const cachePart = (part: string) => (part === "files" ? part : `${part}@${MODEL_CACHE_VERSION}`);

const PRUNED_KEY = "model_cache_pruned";

/**
 * Drops `model`/`rules` rows of any other cache version (the unversioned rows included); run with the schema. Once per
 * version: the `head` kv row `model_cache_pruned` holds the version last pruned for, so a DO start does not rescan.
 */
export function pruneModelCache(sql: SqlStorage): void {
  const done = sql.exec("SELECT v FROM head WHERE k = ?", PRUNED_KEY).toArray()[0]?.v;
  if (done === String(MODEL_CACHE_VERSION)) return;
  sql.exec("DELETE FROM model_cache WHERE part != 'files' AND part NOT LIKE ?", `%@${MODEL_CACHE_VERSION}`);
  sql.exec("INSERT INTO head (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", PRUNED_KEY, String(MODEL_CACHE_VERSION));
}

export class SystemAuthority extends DurableObject<Env> {
  private sql: SqlStorage;
  private clients = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  private lifetimes = new Map<WritableStreamDefaultWriter<Uint8Array>, ReturnType<typeof setTimeout>>();
  private pinger: ReturnType<typeof setInterval> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    applySchema(this.sql);
    pruneModelCache(this.sql);
  }

  listParts(scope: PartScope): PartSummary[] { return new PartsStore(this.sql).listParts(scope); }
  getPart(scope: PartScope, partId: string, version: string): PartRecord | null { return new PartsStore(this.sql).getPart(scope, partId, version); }
  async publishPart(scope: PartScope, pkg: schema.PartPackage): Promise<PartRecord> { return new PartsStore(this.sql).publishPart(scope, pkg); }

  /**
   * Admin `DELETE /api/systems/:id`: wipe this instance's storage so it reads as never imported (`state()` is null).
   * The schema is re-applied and the cached stores dropped, so the same object keeps working on an empty database;
   * open SSE streams are closed. The DO id itself cannot be deleted, so the instance stays addressable but idle.
   */
  async clearState(): Promise<void> {
    for (const w of [...this.clients]) this.drop(w);
    if (this.pinger) { clearInterval(this.pinger); this.pinger = undefined; }
    await this.ctx.storage.deleteAll();
    this.buildsStore = this.changelogStore = this.proposalsStore = this.registryStore = this.phenomeStore = undefined;
    this.readinessMemo.clear();
    applySchema(this.sql);
  }

  private lifecycle(): LifecycleStore { return new LifecycleStore(this.sql); }
  realizationPlans(): RealizationPlan[] { return this.lifecycle().list(); }
  realizationPlan(id: string): RealizationPlan { return this.lifecycle().get(id); }
  createRealizationPlan(input: {title:string;genomeCommit?:string;expectedHead?:string|null;tasks:TaskDefinition[]}): RealizationPlan {
    const state=this.state(); if(!state) throw new ConflictError('not-found','System not imported');
    return this.ctx.storage.transactionSync(()=>this.lifecycle().create(state,input,acceptedTemplateResolver(this.ontologyAcceptedPackages()).digest));
  }
  claimLifecycleTask(pid:string,tid:string,input:TaskClaimRequest,resume=false,preparedBase?:{source:ArtifactBinding;selections:string[]}): ClaimReservation { return this.ctx.storage.transactionSync(()=>this.lifecycle().claim(pid,tid,input,resume,preparedBase)); }
  realizationPlanId(rid:string):string|null {return str(this.one('SELECT task_plan_id FROM realizations WHERE id=?',rid)?.task_plan_id);}
  lifecycleCredentials(pid:string,tid:string):EndedCredential[] {const p=this.lifecycle().get(pid),t=this.lifecycle().task(p,tid);return t.attempts.map(a=>{const r=this.realizationRow(a.realizationId);return {realizationId:a.realizationId,forkRepo:t.forkRepo,tokenId:str(r?.token_id)};}).filter(c=>!!c.tokenId);}
  lifecycleCredentialRevoked(rid:string,tokenId:string):void {this.sql.exec('UPDATE realizations SET token_id=NULL WHERE id=? AND token_id=?',rid,tokenId);}
  realizationBindingId(rid:string):string|null {const row=this.one('SELECT task_binding_id FROM realizations WHERE id=?',rid);return row?.task_binding_id?String(row.task_binding_id):null;}
  realizationPinnedGenome(rid:string):{repo:string;commit:string}|null {const row=this.one('SELECT pinned_genome,pinned_genome_repo FROM realizations WHERE id=?',rid);return row?.pinned_genome&&row.pinned_genome_repo?{repo:String(row.pinned_genome_repo),commit:String(row.pinned_genome)}:null;}
  lifecycleFence(pid:string,tid:string,aid:string,generation:number) { return this.lifecycle().fence(pid,tid,aid,generation); }
  lifecycleActivate(pid:string,tid:string,aid:string,generation:number,input:{tokenId:string;tokenExpires:string;remote:string;secretHash:string}): RealizationPlan { return this.ctx.storage.transactionSync(()=>this.lifecycle().activate(pid,tid,aid,generation,input)); }
  lifecycleEnd(pid:string,tid:string,aid:string,generation:number): void { this.ctx.storage.transactionSync(()=>this.lifecycle().end(pid,tid,aid,generation)); }
  lifecycleCheckpoint(pid:string,tid:string,aid:string,generation:number,input:{message:string;commit?:string}) { return this.ctx.storage.transactionSync(()=>{const f=this.lifecycle().fence(pid,tid,aid,generation);const seq=Number(this.one('SELECT COALESCE(MAX(seq),0)+1 AS n FROM checkpoints WHERE realization_id=?',f.attempt.realizationId)!.n);this.sql.exec('INSERT INTO checkpoints (realization_id,seq,message,commit_hash,created_at) VALUES (?,?,?,?,?)',f.attempt.realizationId,seq,input.message,input.commit??null,nowIso());const plan=this.lifecycle().heartbeat(pid,tid,aid,generation);return {plan,task:this.lifecycle().task(plan,tid)};}); }
  lifecycleCandidate(pid:string,tid:string,aid:string,generation:number,input:Omit<CandidateInput,'realizationId'>) { return this.ctx.storage.transactionSync(()=>{const f=this.lifecycle().fence(pid,tid,aid,generation);const out=this.recordCandidate({...input,realizationId:f.attempt.realizationId});const plan=this.lifecycle().submitted(pid,tid,aid,generation);return {plan,task:this.lifecycle().task(plan,tid),...out};}); }
  lifecycleSelect(pid:string,tid:string,cid:string):RealizationPlan {return this.ctx.storage.transactionSync(()=>this.lifecycle().select(pid,tid,cid));}
  lifecycleIntegrate(pid:string,bindings:IntegratedBinding[],selections:string[]):RealizationPlan {return this.ctx.storage.transactionSync(()=>this.lifecycle().integrate(pid,bindings,selections));}
  lifecycleReserveIntegration(pid:string,artifactId:string,forkRepo:string):RealizationRecord {
    const p=this.lifecycle().get(pid),base=p.baseManifest.artifacts[artifactId];if(!base)throw new ConflictError('invalid-state','artifact not bound');
    const id=`realization.integration.${crypto.randomUUID()}`,at=nowIso(),n=Number(this.one('SELECT COALESCE(MAX(n),0)+1 AS n FROM realizations')!.n);this.setKv('realization_seq',String(n));
    this.sql.exec("INSERT INTO realizations (id,evolution_id,n,target,fork_repo,base_commit,status,created_at,updated_at,base_repo,base_head,role,origin) VALUES (?,'',?,'app',?,?,'working',?,?,?,?,'integrator','cli')",id,n,forkRepo,base.commit,at,at,base.repo,p.baseHead);
    this.sql.exec('UPDATE realizations SET pinned_genome=?,pinned_genome_repo=?,task_plan_id=? WHERE id=?',p.genome.commit,p.genome.repo,p.id,id);this.sql.exec('UPDATE realizations SET task_binding_id=? WHERE id=?',artifactId,id);
    return this.realization(id)!;
  }
  /**
   * Plan promotion. A gate refusal comes back as `{ok:false, code, blocking, advisories}` (a thrown PromotionBlockedError
   * would lose its class and items over RPC); every other refusal still throws.
   */
  async lifecyclePromote(pid:string,input:{candidateIds:string[];expectedHead:string|null;rationale:string;gates:Record<string,GateCriterion[]>;by:string}):Promise<({ok:true}&{plan:RealizationPlan;commit:SystemCommit;ended:EndedCredential[]})|{ok:false;code:PromotionBlockedError['code'];blocking:GateItem[];advisories:GateItem[]}> {
    try{return {ok:true,...await this.lifecyclePromoteTx(pid,input)};}
    catch(e){if(e instanceof PromotionBlockedError)return {ok:false,code:e.code,blocking:e.blocking,advisories:e.advisories};throw e;}
  }
  private async lifecyclePromoteTx(pid:string,input:{candidateIds:string[];expectedHead:string|null;rationale:string;gates:Record<string,GateCriterion[]>;by:string}):Promise<{plan:RealizationPlan;commit:SystemCommit;ended:EndedCredential[]}> {
    const p=this.lifecycle().get(pid),state=this.state()!;
    if(p.status!=='integrated'||!p.integration.length)throw new ConflictError('invalid-state','integrate every binding before promotion');
    const ids=p.integration.map(b=>b.candidateId).sort();if(JSON.stringify(ids)!==JSON.stringify([...input.candidateIds].sort()))throw new ConflictError('invalid-state','reviewed integrated candidates changed');
    if(state.head!==input.expectedHead)throw new StaleBaseRefusal('reviewed System head changed');
    const prep=await this.prepareCommit({artifactId:'',templateVersions:state.manifest!.templateVersions,hookVersions:state.manifest!.hookVersions},prev=>({ ...prev!, artifacts:{...prev!.artifacts,...Object.fromEntries(p.integration.map(b=>[b.artifactId,{...b.source,realizedGenome:p.genome.commit,realizationPlan:p.id}]))} }));
    return this.ctx.storage.transactionSync(()=>{
      const current=this.lifecycle().get(pid);if(this.kv('head')!==prep.head||current.status!=='integrated'||JSON.stringify(current.integration)!==JSON.stringify(p.integration))throw new StaleBaseRefusal('plan or System changed during promotion');
      for(const b of p.integration){const base=p.baseManifest.artifacts[b.artifactId],now=this.readManifest(prep.head)!.artifacts[b.artifactId];if(base.repo!==now?.repo||base.commit!==now.commit)throw new StaleBaseRefusal(`binding ${b.artifactId} changed; replan required`);}
      for(const task of p.tasks){const candidate=task.selectedCandidate?this.candidate(task.selectedCandidate):null;if(!candidate||this.latestCandidate(candidate.realization)?.id!==candidate.id)throw new ConflictError('invalid-state','selected task candidate was superseded; integrate the reviewed latest selection');}
      const cands=p.integration.map(b=>{const c=this.one('SELECT * FROM candidates WHERE id=?',b.candidateId);if(c&&this.latestCandidate(String(c.realization_id))?.id!==c.id)throw new ConflictError('invalid-state','integrated candidate was superseded');if(!c||!['submitted','evaluated','selected'].includes(String(c.state)))throw new ConflictError('invalid-state','integrated candidate unavailable');return {...c,evolution_id:''};});
      const gate=this.checkGate(cands,input.gates,input.rationale);
      const commit=this.writeCommit(prep,[],{by:input.by,policy:'realization-plan',rationale:input.rationale,candidates:ids,realizationPlan:pid,realizedGenome:p.genome.commit,acknowledged:gate.advisories.map(a=>a.criterion),evidenceProviders:gate.evidenceProviders});
      for(const b of p.integration){this.sql.exec("UPDATE candidates SET state='promoted' WHERE id=?",b.candidateId);this.setRealizationStatus(String(this.one('SELECT realization_id FROM candidates WHERE id=?',b.candidateId)!.realization_id),'promoted');}
      const ended=this.endCredentials(p.tasks.flatMap(t=>t.attempts.map(a=>a.realizationId)));
      for(const t of p.tasks){t.status='completed';for(const a of t.attempts)a.status='ended';}
      p.status='promoted';this.lifecycle().save(p);
      const app=p.integration.find(b=>p.baseManifest.artifacts[b.artifactId]?.repo===state.appSource?.repo);if(app){this.setKv('app_source_repo',app.source.repo);this.setKv('app_source_commit',app.source.commit);}
      return {plan:p,commit,ended};
    });
  }
  ontologyInitialize(systemId:string,title?:string) {return new OntologyPackagesStore(this.sql).initialize(systemId,title);}
  ontologyInitial() {return new OntologyPackagesStore(this.sql).initial();}
  ontologyImports() {return new OntologyPackagesStore(this.sql).list();}
  ontologyImportPreview(systemId:string,input:OntologyImportPreviewRequest) {return new OntologyPackagesStore(this.sql).preview(systemId,input);}
  ontologyImportGet(id:string) {return new OntologyPackagesStore(this.sql).get(id);}
  ontologyImportAccept(id:string,hash:string) {const out=new OntologyPackagesStore(this.sql).accept(id,hash);this.sql.exec('DELETE FROM model_cache');this.readinessMemo.clear();return out;}
  ontologyAcceptedPackages() {return new OntologyPackagesStore(this.sql).acceptedPackages();}
  operationsAuditAppend(entry:OperationAuditEntry) {return new OperationsAuditStore(this.sql).append(entry);}
  operationsAuditList(bindingId:string,limit?:number) {return new OperationsAuditStore(this.sql).list(bindingId,limit);}
  operationsAuditBegin(entry:OperationAuditEntry) {return new OperationsAuditStore(this.sql).begin(entry);}

  // ---------------------------------------------------------------- helpers

  private all(q: string, ...args: SqlStorageValue[]): Row[] {
    return this.sql.exec(q, ...args).toArray() as Row[];
  }
  private one(q: string, ...args: SqlStorageValue[]): Row | undefined {
    return this.all(q, ...args)[0];
  }
  private kv(k: string): string | null {
    return str(this.one("SELECT v FROM head WHERE k = ?", k)?.v);
  }
  private setKv(k: string, v: string | null): void {
    this.sql.exec("INSERT INTO head (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
  }

  private emit(event: SseEvent): void {
    if (!this.clients.size) return;
    const envelope: SseEnvelope = { ...event, at: nowIso() };
    const bytes = enc.encode(`data: ${JSON.stringify(envelope)}\n\n`);
    const writes = [...this.clients].map((w) => w.write(bytes).catch(() => this.drop(w)));
    this.ctx.waitUntil(Promise.allSettled(writes));
  }

  private drop(w: WritableStreamDefaultWriter<Uint8Array>): void {
    if (!this.clients.delete(w)) return;
    clearTimeout(this.lifetimes.get(w));
    this.lifetimes.delete(w);
    w.close().catch(() => {});
    if (!this.clients.size && this.pinger) {
      clearInterval(this.pinger);
      this.pinger = undefined;
    }
  }

  // ---------------------------------------------------------------- SSE

  /** `GET …/events`: text/event-stream of {@link SseEnvelope} JSON lines; `ping` every 15 s. */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/events")) return new Response("not found", { status: 404 });
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    this.clients.add(writer);
    this.lifetimes.set(writer, setTimeout(() => this.drop(writer), sseLifetimeMs));
    request.signal?.addEventListener("abort", () => this.drop(writer));
    const hello = `retry: 3000\ndata: ${JSON.stringify({ type: "ping", at: nowIso() })}\n\n`;
    this.ctx.waitUntil(writer.write(enc.encode(hello)).catch(() => this.drop(writer)));
    if (!this.pinger) this.pinger = setInterval(() => this.emit({ type: "ping" }), PING_MS);
    return new Response(readable, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
    });
  }

  // ---------------------------------------------------------------- System head

  private readManifest(head: string | null): SystemManifest | null {
    if (!head) return null;
    return json<SystemManifest | null>(this.one("SELECT manifest_json FROM system_commits WHERE id = ?", head)?.manifest_json, null);
  }

  state(): HeadState | null {
    const systemId = this.kv("system_id");
    if (!systemId) return null;
    const head = this.kv("head");
    return {
      systemId,
      title: this.kv("title") ?? systemId,
      phase: this.kv("phase") ?? undefined,
      head,
      genomeRepo: this.kv("genome_repo")!,
      appRepo: this.kv("app_repo")!,
      genomeCommit: this.kv("genome_commit")!,
      genomeSource: this.kv("genome_source") ?? this.kv("genome_repo")!,
      appSource: this.kv("app_source_commit") ? { repo: this.kv("app_source_repo") ?? this.kv("app_repo")!, commit: this.kv("app_source_commit")! } : null,
      platform: this.platformRef(),
      manifest: this.readManifest(head),
    };
  }

  summary(): SystemSummary | null {
    const s = this.state();
    if (!s) return null;
    const counts: Partial<Record<EvolutionState, number>> = {};
    for (const r of this.all("SELECT status, COUNT(*) AS n FROM evolutions GROUP BY status")) counts[r.status as EvolutionState] = Number(r.n);
    return {
      systemId: s.systemId, title: s.title, head: s.head, genomeRepo: s.genomeRepo, appRepo: s.appRepo,
      genomeCommit: s.genomeCommit, phase: s.phase, evolutionCounts: counts, updatedAt: this.kv("updated_at") ?? nowIso(),
      ...this.summaryExtras(s), // B5 summary (includes B3 builds)
    };
  }

  private platformRef(): PlatformRef | null {
    return json<PlatformRef | null>(this.kv("platform_json"), null);
  }

  private async prepareCommit(extras: ManifestExtras, patch: (prev: SystemManifest | null) => SystemManifest): Promise<PreparedCommit> {
    const head = this.kv("head");
    const manifest = patch(this.readManifest(head));
    manifest.templateVersions = extras.templateVersions;
    manifest.hookVersions = extras.hookVersions;
    manifest.platform = extras.platform !== undefined ? extras.platform : this.platformRef();
    return { head, manifest, manifestHash: await sha256Hex(canonicalJson(manifest)) };
  }

  /** Insert a System commit parented on the current head and move the head. Call inside transactionSync. */
  private writeCommit(prep: PreparedCommit, evolutionIds: string[], decision: Record<string, unknown>): SystemCommit {
    const seq = Number(this.one("SELECT COUNT(*) AS n FROM system_commits")?.n ?? 0) + 1;
    const id = `sc-${seq}-${prep.manifestHash.slice(0, 8)}`;
    const at = nowIso();
    this.sql.exec(
      "INSERT INTO system_commits (id, parent, manifest_json, manifest_hash, evolution_ids, decision_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id, prep.head, JSON.stringify(prep.manifest), prep.manifestHash, JSON.stringify(evolutionIds), JSON.stringify({ ...decision, at }), at,
    );
    this.setKv("head", id);
    this.setKv("updated_at", at);
    return this.commitDto(this.one("SELECT * FROM system_commits WHERE id = ?", id)!);
  }

  private commitDto(r: Row): SystemCommit {
    const d = json<Record<string, unknown>>(r.decision_json, {});
    const composition = json(r.manifest_json, {} as SystemManifest);
    return {
      id: String(r.id),
      parent: str(r.parent),
      genomeCommit: composition.genomeCommit,
      manifest: Object.entries(composition.artifacts ?? {}).map(([artifact, b]) => ({ artifact, type: "worker-fullstack" as const, repo: b.repo, commit: b.commit, scope: [] })),
      composition,
      manifestHash: String(r.manifest_hash),
      evolutions: json(r.evolution_ids, []),
      candidates: (d.candidates as string[]) ?? [],
      rejected: (d.rejected as string[]) ?? [],
      evidence: (d.evidence as string[]) ?? [],
      decision: {
        by: String(d.by ?? "platform"), policy: String(d.policy ?? "admin"), rationale: String(d.rationale ?? ""), at: String(d.at ?? r.created_at),
        ...(Array.isArray(d.acknowledged) && { acknowledged: d.acknowledged.map(String) }),
        ...(Array.isArray(d.evidenceProviders) && { evidenceProviders: d.evidenceProviders.map(String) }),
      },
      createdAt: String(r.created_at),
    };
  }

  /** Repos and commits of the last import (null before the first): an import of exactly these keeps the canonical head. */
  importBase(): { genomeRepo: string; genomeCommit: string; appRepo: string; appCommit: string | null } | null {
    const genomeRepo = this.kv("genome_repo");
    if (!genomeRepo) return null;
    return { genomeRepo, genomeCommit: this.kv("imported_genome_commit")!, appRepo: this.kv("app_repo")!, appCommit: this.kv("imported_app_commit") };
  }

  /**
   * Import: record repos + head commits, write the root System commit (or a new one when the imported
   * commits changed) and seed Evolutions. Idempotent for the same commits.
   * Returns `{ alreadyImported }` (not a throw) when re-pointing an imported System without `force`.
   */
  async bootstrap(input: BootstrapInput): Promise<SystemSummary | { alreadyImported: string }> {
    // Compare with what was last imported (not the current head), so re-importing unchanged repos after a
    // promotion keeps the promoted state.
    const imported = [this.kv("genome_repo"), this.kv("imported_genome_commit"), this.kv("app_repo"), this.kv("imported_app_commit")];
    const unchanged = imported.join("|") === [input.genomeRepo, input.genomeCommit, input.appRepo, input.appCommit].join("|");
    if (!unchanged && imported[0] !== null && !input.force) {
      return { alreadyImported: `system ${input.systemId} is already imported from ${imported[0]}@${String(imported[1]).slice(0, 7)} + ${imported[2]}@${String(imported[3]).slice(0, 7)}; pass force to re-point it` };
    }
    // Same repos and commits but a different `platform` commit: update the recorded provenance in place. No System
    // commit is written, so the head, its versions and every open realization's base stay as they are; the next real
    // System commit carries the new ref in its manifest (prepareCommit falls back to the recorded one).
    const platformMoved = unchanged && imported[0] !== null && canonicalJson(this.platformRef()) !== canonicalJson(input.platform);
    return platformMoved ? this.recordPlatform(input.platform) : this.applyImport(input, unchanged);
  }

  private recordPlatform(platform: PlatformRef | null): SystemSummary {
    this.ctx.storage.transactionSync(() => {
      this.setKv("platform_json", JSON.stringify(platform));
      this.setKv("updated_at", nowIso());
    });
    const summary = this.summary()!;
    this.emit({ type: "system.imported", system: summary });
    return summary;
  }

  private async applyImport(input: BootstrapInput, unchanged: boolean): Promise<SystemSummary> {
    // A re-point of the same app repo without a scaffold source (a re-run of init on a seeded app) keeps the recorded one.
    const prevApp = this.readManifest(this.kv("head"))?.artifacts?.[input.artifactId];
    const scaffoldFrom = input.scaffoldFrom ?? (prevApp && this.kv("app_repo") === input.appRepo ? prevApp.scaffoldFrom : undefined);
    const app: ArtifactBinding | null = input.appCommit ? { repo: input.appRepo, commit: input.appCommit, ...(scaffoldFrom && { scaffoldFrom }) } : null;
    const prep = unchanged ? null : await this.prepareCommit(input, () => ({
      genomeCommit: input.genomeCommit,
      artifacts: input.artifactBindings ?? (app ? { [input.artifactId]: app } : {}),
      templateVersions: {}, hookVersions: {},
    }));
    this.ctx.storage.transactionSync(() => {
      this.setKv("system_id", input.systemId);
      this.setKv("title", input.title);
      if (input.phase) this.setKv("phase", input.phase);
      if (prep) {
        if (this.kv("head") !== prep.head) throw new StaleBaseError(this.kv("head"));
        this.setKv("genome_repo", input.genomeRepo);
        this.setKv("app_repo", input.appRepo);
        this.setKv("genome_commit", input.genomeCommit);
        this.setKv("imported_genome_commit", input.genomeCommit);
        this.setKv("imported_app_commit", input.appCommit);
        this.setKv("genome_source", input.genomeRepo);
        this.setKv("app_source_repo", input.appRepo);
        this.setKv("app_source_commit", input.appCommit);
        this.setKv("platform_json", JSON.stringify(input.platform));
        this.writeCommit(prep, [], {
          by: "platform", policy: "import",
          rationale: `import ${input.genomeRepo}@${input.genomeCommit.slice(0, 7)} + ${input.appRepo}@${input.appCommit?.slice(0, 7) ?? "no source yet"}`,
        });
      }
      this.seedEvolutions(input.evolutions, input.genomeCommit);
    });
    const summary = this.summary()!;
    this.emit({ type: "system.imported", system: summary });
    return summary;
  }

  /** Insert new Evolutions; refresh definitions of known ones but keep their runtime status. */
  private seedEvolutions(evos: EvolutionSeed[], genomeCommit: string): void {
    const at = nowIso();
    for (const e of evos) {
      this.sql.exec(
        `INSERT INTO evolutions (id, title, status, kind, base_commit, scope_json, criteria_json, affected_nodes, created_at, decided_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, kind = excluded.kind, scope_json = excluded.scope_json,
           criteria_json = excluded.criteria_json, affected_nodes = excluded.affected_nodes`,
        e.id, e.title, e.state, e.kind, genomeCommit, JSON.stringify(e), JSON.stringify(e.acceptanceCriteria), JSON.stringify(e.affectedNodes), at,
      );
    }
  }

  // ---------------------------------------------------------------- model cache

  /** Cache JSON parts (`files`, `model`, `rules`) for a Genome commit. Each part is one row (< 2 MB). */
  putModelCache(genomeCommit: string, parts: Record<string, string>): void {
    const at = nowIso();
    for (const [part, text] of Object.entries(parts)) {
      this.sql.exec("INSERT OR REPLACE INTO model_cache (genome_commit, part, json, created_at) VALUES (?, ?, ?, ?)", genomeCommit, cachePart(part), text, at);
    }
  }

  /**
   * Replace the stored conflict reports involving `candidateId` with a fresh run (computed at submit and promote).
   * Reports are keyed by kind + candidates + subjects, so a pair computed from either side is stored once.
   */
  storeConflicts(candidateId: string, reports: StoredConflict[], error: string | null): void {
    const at = nowIso();
    this.ctx.storage.transactionSync(() => {
      for (const r of this.all("SELECT key, candidates_json FROM conflict_reports")) {
        if (json<string[]>(r.candidates_json, []).includes(candidateId)) this.sql.exec("DELETE FROM conflict_reports WHERE key = ?", r.key);
      }
      for (const r of reports) {
        const cands = [...r.candidates].sort();
        const key = `${r.kind}|${cands.join(",")}|${[...r.subjects].sort().join(",")}`;
        this.sql.exec("INSERT OR REPLACE INTO conflict_reports (key, candidates_json, json, computed_at) VALUES (?, ?, ?, ?)", key, JSON.stringify(cands), JSON.stringify(r), at);
      }
      this.sql.exec("INSERT OR REPLACE INTO conflict_runs (candidate_id, computed_at, error) VALUES (?, ?, ?)", candidateId, at, error);
    });
  }

  /** Stored reports among open candidates (optionally those involving `candidateId`), with run times and errors. */
  storedConflicts(candidateId?: string): { conflicts: StoredConflict[]; computedAt: string | null; errors: { candidate: string; error: string }[] } {
    const open = new Set(this.all("SELECT id FROM candidates WHERE state IN ('submitted', 'evaluated', 'selected')").map((r) => String(r.id)));
    const conflicts: StoredConflict[] = [];
    for (const r of this.all("SELECT candidates_json, json FROM conflict_reports ORDER BY key")) {
      const cands = json<string[]>(r.candidates_json, []);
      if (!cands.every((c) => open.has(c)) || (candidateId && !cands.includes(candidateId))) continue;
      conflicts.push(json<StoredConflict>(r.json, {} as StoredConflict));
    }
    const runs = this.all("SELECT candidate_id, computed_at, error FROM conflict_runs")
      .filter((r) => open.has(String(r.candidate_id)) && (!candidateId || r.candidate_id === candidateId));
    const computedAt = runs.map((r) => String(r.computed_at)).sort().at(-1) ?? null;
    const errors = runs.filter((r) => r.error != null).map((r) => ({ candidate: String(r.candidate_id), error: String(r.error) }));
    return { conflicts, computedAt, errors };
  }

  /** Known blob sizes (git blob hashes are immutable, so a size never changes). */
  blobSizes(hashes: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (let i = 0; i < hashes.length; i += 90) {
      const chunk = hashes.slice(i, i + 90);
      for (const r of this.all(`SELECT hash, size FROM blob_sizes WHERE hash IN (${chunk.map(() => "?").join(",")})`, ...chunk)) out[String(r.hash)] = Number(r.size);
    }
    return out;
  }

  putBlobSizes(sizes: Record<string, number>): void {
    for (const [hash, size] of Object.entries(sizes)) this.sql.exec("INSERT OR IGNORE INTO blob_sizes (hash, size) VALUES (?, ?)", hash, size);
  }

  /** Persist the hooks' runGenome result (readiness + DeltaReviews) for a Genome candidate. */
  putReview(candidateId: string, json: string): void {
    this.sql.exec("INSERT OR REPLACE INTO candidate_reviews (candidate_id, json, created_at) VALUES (?, ?, ?)", candidateId, json, nowIso());
  }

  review(candidateId: string): string | null {
    return str(this.one("SELECT json FROM candidate_reviews WHERE candidate_id = ?", candidateId)?.json);
  }

  getModelCache(genomeCommit: string, part: string): string | null {
    return str(this.one("SELECT json FROM model_cache WHERE genome_commit = ? AND part = ?", genomeCommit, cachePart(part))?.json);
  }

  // ---------------------------------------------------------------- evolutions

  private evolutionDto(r: Row): Evolution {
    const seed = json<EvolutionSeed>(r.scope_json, {} as EvolutionSeed);
    const id = String(r.id);
    const realizations = this.all("SELECT id FROM realizations WHERE evolution_id = ? ORDER BY n", id).map((x) => String(x.id));
    const decided = r.decided_at == null ? undefined : this.all("SELECT decision_json, evolution_ids FROM system_commits ORDER BY rowid DESC")
      .find((c) => json<string[]>(c.evolution_ids, []).includes(id));
    const d = decided ? json<Record<string, string>>(decided.decision_json, {}) : undefined;
    return {
      id, title: String(r.title), intent: seed.intent ?? "", state: String(r.status) as EvolutionState,
      baseRevision: seed.baseRevision, kind: seed.kind, affectedNodes: seed.affectedNodes ?? [], affectedClaims: seed.affectedClaims ?? [],
      genomeDelta: seed.genomeDelta ?? [], acceptanceCriteria: seed.acceptanceCriteria ?? [], requiredEvidence: seed.requiredEvidence ?? [],
      dependsOn: seed.dependsOn ?? [], risk: seed.risk ?? "medium", realizations,
      ...(d && { decision: d.rationale, decisionRecord: { by: d.by, policy: d.policy, rationale: d.rationale, at: d.at } }),
    };
  }

  evolutions(): Evolution[] {
    return this.all("SELECT * FROM evolutions ORDER BY id").map((r) => this.evolutionDto(r));
  }

  evolution(id: string): Evolution | null {
    const r = this.one("SELECT * FROM evolutions WHERE id = ?", id);
    return r ? this.evolutionDto(r) : null;
  }

  work(): WorkResponse {
    return { evolutions: this.evolutions(), realizations: this.realizations() };
  }

  private setEvolutionStatus(id: string, status: EvolutionState, decided = false): void {
    if (decided) this.sql.exec("UPDATE evolutions SET status = ?, decided_at = ? WHERE id = ?", status, nowIso(), id);
    else this.sql.exec("UPDATE evolutions SET status = ? WHERE id = ?", status, id);
  }

  // ---------------------------------------------------------------- realizations

  private realizationDto(r: Row): Realization {
    const id = String(r.id);
    const checkpoints: Checkpoint[] = this.all("SELECT * FROM checkpoints WHERE realization_id = ? ORDER BY seq", id).map((c) => ({
      seq: Number(c.seq), at: String(c.created_at), summary: String(c.message ?? ""), ...(c.commit_hash != null && { commit: String(c.commit_hash) }),
    }));
    const cand = this.one("SELECT id FROM candidates WHERE realization_id = ? ORDER BY rowid DESC LIMIT 1", id);
    return {
      id,
      systemId: this.kv("system_id") ?? "",
      evolution: String(r.evolution_id),
      n: Number(r.n),
      agent: { id: str(r.agent_label) ?? `agent-${r.n}`, role: (str(r.role) ?? "implementer") as Realization["agent"]["role"] },
      target: String(r.target) as "app" | "genome",
      mode: "local",
      origin: (str(r.origin) ?? "cli") as RealizationOrigin,
      workspace: {
        repo: String(r.base_repo ?? ""), fork: String(r.fork_repo), baseCommit: String(r.base_commit ?? ""),
        ...(r.token_expires != null && { tokenExpiresAt: String(r.token_expires) }),
        ...(r.remote != null && { remote: String(r.remote) }),
      },
      baseRevision: str(r.base_head),
      status: String(r.status) as RealizationStatus,
      checkpoints,
      ...(cand && { candidate: String(cand.id) }),
      ...(r.rejection_reason != null && { rejectionReason: String(r.rejection_reason) }),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  private realizationRow(id: string): Row | undefined {
    return this.one("SELECT * FROM realizations WHERE id = ?", id);
  }

  realizations(evolutionId?: string): Realization[] {
    const rows = evolutionId
      ? this.all("SELECT * FROM realizations WHERE evolution_id = ? ORDER BY n", evolutionId)
      : this.all("SELECT * FROM realizations ORDER BY n");
    return rows.map((r) => this.realizationDto(r));
  }

  realization(id: string): RealizationRecord | null {
    const r = this.realizationRow(id);
    if (!r) return null;
    return {
      realization: this.realizationDto(r),
      packet: json<TaskPacket | null>(r.packet_json, null),
      packetHash: str(r.packet_hash),
      target: String(r.target) as "app" | "genome",
      forkRepo: String(r.fork_repo),
      baseRepo: String(r.base_repo ?? ""),
      baseCommit: String(r.base_commit ?? ""),
      evolutionId: String(r.evolution_id),
      tokenId: str(r.token_id),
    };
  }

  private setRealizationStatus(id: string, status: RealizationStatus): void {
    this.sql.exec("UPDATE realizations SET status = ?, updated_at = ? WHERE id = ?", status, nowIso(), id);
  }

  /** The fork name the next realization for `target` would get (realization numbers are System-wide). */
  nextForkName(target: "app" | "genome"): { n: number; forkRepo: string } | null {
    const s = this.state();
    if (!s) return null;
    const n = Number(this.kv("realization_seq") ?? 0) + 1;
    return { n, forkRepo: forkName(target === "genome" ? s.genomeRepo : s.appRepo, n) };
  }

  /** Skip realization number `n` (its fork name is taken in the namespace, e.g. by an earlier platform state). No-op unless `n` is next. */
  skipRealizationNumber(n: number): void {
    this.ctx.storage.transactionSync(() => {
      if (Number(this.kv("realization_seq") ?? 0) + 1 === n) this.setKv("realization_seq", String(n));
    });
  }

  /**
   * Allocate the next realization number (System-wide, so fork names never collide across Evolutions)
   * and record it as `claimed`. The Worker then forks, issues a token and calls {@link activateRealization}.
   */
  reserveRealization(input: ReserveInput): ReservedRealization {
    const s = this.state();
    if (!s) throw new ConflictError("not-found", "System not imported");
    return this.ctx.storage.transactionSync(() => {
      const evo = this.one("SELECT status,kind FROM evolutions WHERE id = ?", input.evolutionId);
      if(input.target==='app'&&evo?.kind==='genome-amendment')throw new ConflictError('invalid-state','Genome Evolutions cannot own app work; create a realization plan');
      if (!evo) throw new ConflictError("not-found", `unknown evolution ${input.evolutionId}`);
      if (["promoted", "rejected", "withdrawn"].includes(String(evo.status))) {
        throw new ConflictError("invalid-state", `evolution ${input.evolutionId} is ${evo.status}`);
      }
      if (input.target === "app" && !s.appSource) throw new ConflictError("invalid-state", "This Thing has no source artifact yet; accept a Genome binding and import its source before application work");
      const baseRepo = input.target === "genome" ? s.genomeSource : s.appSource!.repo;
      const baseCommit = input.target === "genome" ? s.genomeCommit : s.appSource!.commit;
      if (input.expectedBase !== undefined && input.expectedBase !== baseCommit) {
        throw new StaleBaseRefusal(`the ${input.target === "genome" ? "Genome" : "app"} moved from ${input.expectedBase.slice(0, 12)} to ${baseCommit.slice(0, 12)}`);
      }
      const n = Number(this.kv("realization_seq") ?? 0) + 1;
      this.setKv("realization_seq", String(n));
      const id = `realization.${evolutionShort(input.evolutionId)}.r${n}`;
      const namingRepo = input.target === "genome" ? s.genomeRepo : s.appRepo;
      const forkRepo = forkName(namingRepo, n);
      const at = nowIso();
      this.sql.exec(
        `INSERT INTO realizations (id, evolution_id, n, target, fork_repo, base_commit, agent_label, status, created_at, updated_at, base_repo, base_head, role, origin)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'claimed', ?, ?, ?, ?, ?, ?)`,
        id, input.evolutionId, n, input.target, forkRepo, baseCommit, input.agentLabel ?? null, at, at, baseRepo, s.head, input.role ?? "implementer",
        input.origin ?? "cli",
      );
      if (["proposed", "genome-approved", "actionable"].includes(String(evo.status))) this.setEvolutionStatus(input.evolutionId, "realizing");
      return { realization: this.realizationDto(this.realizationRow(id)!), baseRepo, baseCommit, forkRepo };
    });
  }

  /**
   * Store token metadata and the SHA-256 of the realization secret (never either plaintext) and the packet; emits
   * `realization.created`. Only a `claimed` realization is activated: one rejected or abandoned while its fork was being
   * made returns `{ refused }` with its status, and the Worker revokes the token it minted.
   */
  activateRealization(id: string, input: { tokenId: string; tokenExpires: string; remote: string; packet: TaskPacket; secretHash: string }): Realization | { refused: RealizationStatus | null } {
    const changed = this.sql.exec(
      "UPDATE realizations SET token_id = ?, token_expires = ?, remote = ?, packet_json = ?, packet_hash = ?, secret_hash = ?, updated_at = ? WHERE id = ? AND status = 'claimed'",
      input.tokenId, input.tokenExpires, input.remote, JSON.stringify(input.packet), input.packet.hash, input.secretHash, nowIso(), id,
    ).rowsWritten;
    if (!changed) return { refused: (str(this.realizationRow(id)?.status) as RealizationStatus | null) };
    const r = this.realizationDto(this.realizationRow(id)!);
    this.emit({ type: "realization.created", realization: r });
    const evo = this.evolution(r.evolution);
    if (evo) this.emit({ type: "evolution.updated", evolution: evo });
    return r;
  }

  /** A failed start: `claimed` → `abandoned`. A realization that already ended (e.g. rejected meanwhile) keeps its status. */
  abandonRealization(id: string): void {
    this.sql.exec("UPDATE realizations SET status = 'abandoned', updated_at = ? WHERE id = ? AND status = 'claimed'", nowIso(), id);
  }

  /** Admin rejection (e.g. a Genome amendment): realization and its open candidates → rejected, reason kept. */
  rejectRealization(id: string, reason: string): Realization {
    const r = this.realizationRow(id);
    if (!r) throw new ConflictError("not-found", `unknown realization ${id}`);
    if (["promoted", "accepted"].includes(String(r.status))) throw new ConflictError("invalid-state", `realization ${id} is ${r.status}`);
    this.ctx.storage.transactionSync(() => {
      // Rejection revokes the realization secret together with the fork's write token.
      this.sql.exec("UPDATE realizations SET status = 'rejected', rejection_reason = ?, secret_hash = NULL, updated_at = ? WHERE id = ?", reason, nowIso(), id);
      this.sql.exec("UPDATE candidates SET state = 'rejected' WHERE realization_id = ? AND state != 'promoted'", id);
    });
    const dto = this.realizationDto(this.realizationRow(id)!);
    this.emit({ type: "realization.updated", realization: dto });
    return dto;
  }

  /** SHA-256 (hex) of the realization's secret; null when unknown, not yet active, or revoked. */
  realizationSecretHash(id: string): string | null {
    const row=this.realizationRow(id);
    if(row?.task_plan_id){const p=this.lifecycle().get(String(row.task_plan_id)),task=p.tasks.find(t=>t.attempts.some(a=>a.realizationId===id)),attempt=task?.attempts.at(-1);if(!attempt||attempt.realizationId!==id||attempt.status==='ended'||Date.parse(attempt.leaseExpiresAt)<=Date.now())return null;}
    return str(row?.secret_hash);
  }

  /** Append a checkpoint; a repeat of the last (summary, commit) is a no-op. claimed → working. */
  checkpoint(id: string, input: { summary: string; commit?: string }): { realization: Realization; checkpoint: Checkpoint } {
    if(this.realizationPlanId(id))throw new ConflictError('invalid-state','Task Attempts must use lifecycle checkpoint with fenced generation');
    const r = this.realizationRow(id);
    if (!r) throw new ConflictError("not-found", `unknown realization ${id}`);
    const last = this.one("SELECT * FROM checkpoints WHERE realization_id = ? ORDER BY seq DESC LIMIT 1", id);
    if (last && String(last.message) === input.summary && str(last.commit_hash) === (input.commit ?? null)) {
      return {
        realization: this.realizationDto(r),
        checkpoint: { seq: Number(last.seq), at: String(last.created_at), summary: input.summary, ...(input.commit && { commit: input.commit }) },
      };
    }
    const seq = Number(last?.seq ?? 0) + 1;
    const at = nowIso();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO checkpoints (realization_id, seq, message, commit_hash, created_at) VALUES (?, ?, ?, ?, ?)", id, seq, input.summary, input.commit ?? null, at);
      if (r.status === "claimed") this.setRealizationStatus(id, "working");
      else this.sql.exec("UPDATE realizations SET updated_at = ? WHERE id = ?", at, id);
    });
    const checkpoint: Checkpoint = { seq, at, summary: input.summary, ...(input.commit && { commit: input.commit }) };
    const realization = this.realizationDto(this.realizationRow(id)!);
    this.emit({ type: "checkpoint", realization: id, checkpoint });
    this.emit({ type: "realization.updated", realization });
    return { realization, checkpoint };
  }

  // ---------------------------------------------------------------- candidates + evaluations

  private candidateDto(r: Row): Candidate {
    const real = this.realizationRow(String(r.realization_id));
    const manifest = json<Record<string, unknown>>(r.manifest_json, {});
    return {
      id: String(r.id),
      realization: String(r.realization_id),
      evolution: String(real?.evolution_id ?? ""),
      commit: String(r.commit_hash),
      ...(Array.isArray(manifest.composedFrom) && { composedFrom: manifest.composedFrom as string[] }),
      baseRevision: String(real?.base_head ?? ""),
      changedPaths: json(r.changed_paths, []),
      changedSubjects: json(r.changed_nodes, []),
      genomeChanges: (manifest.genomeChanges as string[]) ?? [],
      submittedAt: String(r.created_at),
      state: String(r.state) as Candidate["state"],
    };
  }

  /** Candidate manifest JSON as stored at submission. */
  candidateManifest(id: string): Record<string, unknown> | null {
    return json(this.one("SELECT manifest_json FROM candidates WHERE id = ?", id)?.manifest_json, null);
  }

  /** Idempotent on (realization, commit): a repeat returns the existing candidate with `created: false`. */
  recordCandidate(input: CandidateInput): { candidate: Candidate; created: boolean; realization: Realization } {
    const r = this.realizationRow(input.realizationId);
    if (!r) throw new ConflictError("not-found", `unknown realization ${input.realizationId}`);
    const existing = this.one("SELECT * FROM candidates WHERE realization_id = ? AND commit_hash = ?", input.realizationId, input.commit);
    if (existing) return { candidate: this.candidateDto(existing), created: false, realization: this.realizationDto(r) };
    if (TERMINAL_REALIZATION.includes(String(r.status) as RealizationStatus)) {
      throw new ConflictError("invalid-state", `realization ${input.realizationId} is ${r.status}`);
    }
    const id = `candidate.${r.task_plan_id?"task":evolutionShort(String(r.evolution_id))}.r${r.n}.${input.commit.slice(0, 7)}`;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO candidates (id, realization_id, commit_hash, manifest_json, changed_paths, changed_nodes, created_at, state) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted')",
        id, input.realizationId, input.commit, JSON.stringify(input.manifest), JSON.stringify(input.changedPaths), JSON.stringify(input.changedNodes), nowIso(),
      );
      this.setRealizationStatus(input.realizationId, "evaluating");
    });
    const candidate = this.candidateDto(this.one("SELECT * FROM candidates WHERE id = ?", id)!);
    const realization = this.realizationDto(this.realizationRow(input.realizationId)!);
    this.emit({ type: "candidate.submitted", candidate });
    this.emit({ type: "realization.updated", realization });
    return { candidate, created: true, realization };
  }

  /**
   * Store a preview URL on an open candidate that was created without one (a queue submit that beat the CLI's).
   * Returns false when the candidate already has a preview or is no longer open. The manifest hash excludes the preview.
   */
  setPreviewUrl(candidateId: string, previewUrl: string): boolean {
    const c = this.one("SELECT manifest_json, state FROM candidates WHERE id = ?", candidateId);
    if (!c || !OPEN_CANDIDATE.includes(String(c.state))) return false;
    const manifest = json<Record<string, unknown>>(c.manifest_json, {});
    if (manifest.previewUrl) return false;
    this.sql.exec("UPDATE candidates SET manifest_json = ? WHERE id = ?", JSON.stringify({ ...manifest, previewUrl }), candidateId);
    return true;
  }

  /**
   * Record the screenshots an agent attached at submit (refs into the evidence bucket) on the candidate manifest. Like
   * the preview URL, they are not part of the manifest hash; a later submit of the same open candidate replaces them.
   */
  setCandidateScreenshots(candidateId: string, screenshots: EvidenceImageRef[]): boolean {
    const c = this.one("SELECT manifest_json, state FROM candidates WHERE id = ?", candidateId);
    if (!c || !OPEN_CANDIDATE.includes(String(c.state))) return false;
    const manifest = json<Record<string, unknown>>(c.manifest_json, {});
    this.sql.exec("UPDATE candidates SET manifest_json = ? WHERE id = ?", JSON.stringify({ ...manifest, screenshots }), candidateId);
    return true;
  }

  // ---- B1 editor: thin delegate ----
  /**
   * Record an editor commit's `why` on the candidate manifest as `rationale`; a blank one sets `rationalePending`.
   * Like the preview URL, it is not part of the manifest hash. Returns false for an unknown candidate.
   */
  setCandidateRationale(candidateId: string, rationale: string | null): boolean {
    const c = this.one("SELECT manifest_json FROM candidates WHERE id = ?", candidateId);
    if (!c) return false;
    const { rationale: _r, rationalePending: _p, ...manifest } = json<Record<string, unknown>>(c.manifest_json, {});
    const next = rationale?.trim() ? { ...manifest, rationale: rationale.trim() } : { ...manifest, rationalePending: true };
    this.sql.exec("UPDATE candidates SET manifest_json = ? WHERE id = ?", JSON.stringify(next), candidateId);
    return true;
  }
  // ---- end B1 editor ----

  /** Claim the hook re-run for `candidateId` so concurrent retries do not all run it; a claim lapses after `ttlMs`. */
  claimEvaluation(candidateId: string, ttlMs = 5 * 60_000): boolean {
    const now = Date.now();
    return this.ctx.storage.transactionSync(() => {
      const held = this.one("SELECT claimed_at FROM evaluation_claims WHERE candidate_id = ?", candidateId);
      if (held && now - Number(held.claimed_at) < ttlMs) return false;
      this.sql.exec("INSERT OR REPLACE INTO evaluation_claims (candidate_id, claimed_at) VALUES (?, ?)", candidateId, now);
      return true;
    });
  }

  releaseEvaluation(candidateId: string): void {
    this.sql.exec("DELETE FROM evaluation_claims WHERE candidate_id = ?", candidateId);
  }

  /**
   * Upsert evaluations (one row per candidate × criterion × hook), move the candidate to `evaluated`
   * and its realization to `status` (evaluated, or awaiting-admin for Genome candidates). `replace` first drops the
   * candidate's earlier evaluations (an admin re-run); it refuses (`invalid-state`) once the candidate is promoted or
   * rejected, so a decision that landed while the hooks ran keeps its evidence.
   */
  recordEvaluations(candidateId: string, evaluations: Evaluation[], status?: RealizationStatus, replace = false): Evaluation[] {
    const cand = this.one("SELECT * FROM candidates WHERE id = ?", candidateId);
    if (!cand) throw new ConflictError("not-found", `unknown candidate ${candidateId}`);
    const stored: Evaluation[] = [];
    this.ctx.storage.transactionSync(() => {
      if (replace) {
        const state = String(this.one("SELECT state FROM candidates WHERE id = ?", candidateId)?.state);
        if (!OPEN_CANDIDATE.includes(state)) throw new ConflictError("invalid-state", `candidate ${candidateId} is ${state}`);
        this.sql.exec("DELETE FROM evaluations WHERE candidate_id = ?", candidateId);
      }
      for (const e of evaluations) {
        const at = e.finishedAt ?? e.startedAt ?? nowIso();
        const hook = e.hook || "none";
        const id = e.id || `${candidateId}:${hook}:${e.criterion}`;
        const { id: _i, candidate: _c, criterion: _k, hook: _h, execution: _x, verdict: _v, observations, verifier: _vf, ...extra } = e;
        this.sql.exec("DELETE FROM evaluations WHERE candidate_id = ? AND criterion_id = ? AND hook_id = ?", candidateId, e.criterion, hook);
        this.sql.exec(
          "INSERT OR REPLACE INTO evaluations (id, candidate_id, criterion_id, hook_id, execution, verdict, observations_json, evidence_key, verifier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          id, candidateId, e.criterion, hook, e.execution, e.verdict, JSON.stringify({ observations: observations ?? [], extra }),
          e.provenance?.evidenceKey ?? null, e.verifier ?? "artyfact-platform", at,
        );
        stored.push({ ...e, id, candidate: candidateId, hook });
      }
      if (OPEN_CANDIDATE.includes(String(cand.state))) this.sql.exec("UPDATE candidates SET state = 'evaluated' WHERE id = ?", candidateId);
      const real = this.realizationRow(String(cand.realization_id));
      if (status && real && !TERMINAL_REALIZATION.includes(String(real.status) as RealizationStatus)) this.setRealizationStatus(String(cand.realization_id), status);
      const evo = real && this.one("SELECT status FROM evolutions WHERE id = ?", real.evolution_id);
      if (real && evo && ["realizing", "actionable", "proposed", "genome-approved"].includes(String(evo.status))) {
        this.setEvolutionStatus(String(real.evolution_id), "evaluated");
      }
    });
    for (const e of stored) this.emit({ type: "evaluation.completed", evaluation: e });
    const real = this.realizationRow(String(cand.realization_id));
    if (real) this.emit({ type: "realization.updated", realization: this.realizationDto(real) });
    return stored;
  }

  private evaluationDto(r: Row): Evaluation {
    const o = json<{ observations?: unknown[]; extra?: Partial<Evaluation> }>(r.observations_json, {});
    return {
      ownerId: "", subjectId: "", targetRef: "", startedAt: String(r.created_at), limitations: [], provenance: {},
      ...(o.extra ?? {}),
      id: String(r.id), candidate: String(r.candidate_id), criterion: String(r.criterion_id), hook: String(r.hook_id),
      execution: String(r.execution) as Evaluation["execution"], verdict: String(r.verdict) as Evaluation["verdict"],
      observations: Array.isArray(o.observations) ? o.observations : [],
      verifier: String(r.verifier ?? "artyfact-platform"),
    };
  }

  evaluations(candidateId?: string): Evaluation[] {
    const rows = candidateId
      ? this.all("SELECT * FROM evaluations WHERE candidate_id = ? ORDER BY criterion_id, hook_id", candidateId)
      : this.all("SELECT * FROM evaluations ORDER BY created_at DESC");
    return rows.map((r) => this.evaluationDto(r));
  }

  candidates(filter: { evolutionId?: string; realizationId?: string; open?: boolean } = {}): Candidate[] {
    const rows = this.all(
      `SELECT c.* FROM candidates c JOIN realizations r ON r.id = c.realization_id
       WHERE (?1 IS NULL OR r.evolution_id = ?1) AND (?2 IS NULL OR c.realization_id = ?2)
       ORDER BY c.rowid DESC`,
      filter.evolutionId ?? null, filter.realizationId ?? null,
    );
    return rows.map((r) => this.candidateDto(r)).filter((c) => !filter.open || OPEN_CANDIDATE.includes(c.state));
  }

  candidate(id: string): Candidate | null {
    const r = this.one("SELECT * FROM candidates WHERE id = ?", id);
    return r ? this.candidateDto(r) : null;
  }

  /** Gate criteria lacking `verdict=pass && execution=completed` on every evaluation for `candidateId`. */
  gateItems(candidateId: string, gates: GateCriterion[]): GateItem[] {
    type V = GateItem["verdict"];
    type X = GateItem["execution"];
    const out: GateItem[] = [];
    for (const { id: criterion, severity, offTriggerHooks } of gates) {
      // The Worker names, from the Genome, the hooks that never run before promotion; only their not-run rows are
      // disregarded. A not-run row of any other hook keeps the criterion blocking, whatever else passed.
      const off = new Set(offTriggerHooks ?? []);
      const rows = this.all("SELECT verdict, execution, hook_id FROM evaluations WHERE candidate_id = ? AND criterion_id = ?", candidateId, criterion)
        .filter((r) => !(r.execution === "not-run" && off.has(String(r.hook_id))));
      // Missing evidence is unknown, never pass.
      if (!rows.length) out.push({ candidate: candidateId, criterion, severity, verdict: "unknown", execution: "missing" });
      for (const r of rows) {
        if (r.verdict !== "pass" || r.execution !== "completed") out.push({ candidate: candidateId, criterion, severity, verdict: String(r.verdict) as V, execution: String(r.execution) as X });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- promotion

  /**
   * The gate shared by promote and accept, inside the caller's transaction. Throws {@link PromotionBlockedError} when
   * a blocking criterion lacks pass+completed, or when advisories exist and `rationale` is empty. Returns the
   * advisories and the distinct System One providers behind the gating evaluations.
   */
  private checkGate(rows: Row[], computed: Record<string, GateCriterion[] | undefined>, rationale: string): { advisories: GateItem[]; evidenceProviders: string[] } {
    const items: GateItem[] = [];
    const blockingIds = new Set<string>();
    const providers = new Set<string>();
    for (const c of rows) {
      const gates = this.effectiveGates(c, computed[String(c.id)]);
      items.push(...this.gateItems(String(c.id), gates));
      for (const g of gates) {
        if (g.blocking) blockingIds.add(`${c.id}|${g.id}`);
        for (const p of this.evaluationProviders(String(c.id), g.id)) providers.add(p);
      }
    }
    const blocking = items.filter((i) => blockingIds.has(`${i.candidate}|${i.criterion}`));
    const advisories = items.filter((i) => !blockingIds.has(`${i.candidate}|${i.criterion}`));
    if (blocking.length) throw new PromotionBlockedError("blocked", blocking, advisories);
    if (advisories.length && !rationale.trim()) throw new PromotionBlockedError("advisories-unacknowledged", [], advisories);
    return { advisories, evidenceProviders: [...providers].sort() };
  }

  /** System One providers recorded in the provenance of a candidate's evaluations for one criterion. */
  private evaluationProviders(candidateId: string, criterion: string): string[] {
    return this.all("SELECT observations_json FROM evaluations WHERE candidate_id = ? AND criterion_id = ?", candidateId, criterion)
      .flatMap((r) => String(json<{ extra?: { provenance?: Record<string, unknown> } }>(r.observations_json, {}).extra?.provenance?.provider ?? "").split(","))
      .map((p) => p.trim())
      .filter((p) => p && p !== "none");
  }

  /**
   * The gate actually enforced for one candidate, failing closed:
   * - no Worker-computed gate → `gate-unavailable`;
   * - the Evolution's acceptance criteria (from this DO's record) are always in; any the Worker did not classify block;
   * - an empty blocking set is only acceptable with ≥1 acceptance criterion, every one evaluated for this candidate.
   */
  private effectiveGates(c: Row, computed: GateCriterion[] | undefined): GateCriterion[] {
    const id = String(c.id);
    if (!computed) throw new GateUnavailableError(`no gate criteria were computed for ${id}`);
    const acceptance = json<string[]>(this.one("SELECT criteria_json FROM evolutions WHERE id = ?", c.evolution_id)?.criteria_json, []);
    const gates = new Map(computed.map((g) => [g.id, g] as const));
    for (const a of acceptance) if (!gates.has(a)) gates.set(a, { id: a, severity: "hard", blocking: true });
    const deferred = new Set(computed.filter((g) => g.deferred).map((g) => g.id));
    const out = [...gates.values()].filter((g) => !g.deferred);
    if (!out.some((g) => g.blocking)) {
      const live = acceptance.filter((a) => !deferred.has(a));
      if (!live.length) throw new GateUnavailableError(`${id} has no blocking criteria and its Evolution has no (non-deferred) acceptance criteria`);
      // "Evaluated" means a completed run (any verdict): the runner writes a not-run row for every unrunnable acceptance criterion.
      const unevaluated = live.filter((a) => !this.one("SELECT 1 AS x FROM evaluations WHERE candidate_id = ? AND criterion_id = ? AND execution = 'completed'", id, a));
      if (unevaluated.length) throw new GateUnavailableError(`${id} has no blocking criteria and acceptance criteria ${unevaluated.join(", ")} are unevaluated`);
    }
    return out;
  }

  private promotionRows(candidateIds: string[]): (Row | undefined)[] {
    return candidateIds.map((id) => this.one(
      "SELECT c.id, c.commit_hash, r.fork_repo, r.target FROM candidates c JOIN realizations r ON r.id = c.realization_id WHERE c.id = ?", id,
    ));
  }

  private compose(cands: (Row | undefined)[], artifactId: string, prev: SystemManifest | null): SystemManifest {
    const artifacts = { ...(prev?.artifacts ?? {}) };
    let genomeCommit = prev?.genomeCommit ?? this.kv("genome_commit") ?? "";
    for (const c of cands) {
      if (!c) continue;
      if (c.target === "genome") genomeCommit = String(c.commit_hash);
      else artifacts[artifactId] = { ...artifacts[artifactId], repo: String(c.fork_repo), commit: String(c.commit_hash) };
    }
    return { genomeCommit, artifacts, templateVersions: {}, hookVersions: {} };
  }

  /**
   * Why the composed manifest does not bind exactly these candidates' commits (empty when it does).
   * Until multi-candidate composition exists, at most one candidate per target can be promoted at once.
   */
  private compositionProblems(cands: Row[], artifactId: string, manifest: SystemManifest): string[] {
    const problems: string[] = [];
    for (const target of ["app", "genome"]) {
      const n = cands.filter((c) => String(c.target) === target).length;
      if (n > 1) problems.push(`${n} ${target} candidates cannot be composed into one System commit yet; promote one at a time`);
    }
    for (const c of cands) {
      const bound = c.target === "genome"
        ? manifest.genomeCommit === String(c.commit_hash)
        : manifest.artifacts[artifactId]?.commit === String(c.commit_hash) && manifest.artifacts[artifactId]?.repo === String(c.fork_repo);
      if (!bound) problems.push(`the composed manifest does not bind ${c.id} at ${String(c.commit_hash).slice(0, 12)}`);
    }
    return problems;
  }

  /** The promotion-time `manifestExact` fact: composing `candidateIds` onto the head binds exactly their commits. */
  composedManifestExact(candidateIds: string[], artifactId: string): { exact: boolean; problems: string[] } {
    const cands = this.promotionRows(candidateIds);
    if (cands.some((c) => !c)) return { exact: false, problems: ["unknown candidate"] };
    const problems = this.compositionProblems(cands as Row[], artifactId, this.compose(cands, artifactId, this.readManifest(this.kv("head"))));
    return { exact: problems.length === 0, problems };
  }

  /** Compose the next manifest for promoting `candidateIds` and hash it (async, so outside the transaction). */
  async preparePromotion(input: PromoteInput): Promise<PreparedCommit> {
    const cands = this.promotionRows(input.candidateIds);
    return this.prepareCommit(input, (prev) => this.compose(cands, input.artifactId, prev));
  }

  /**
   * Compare-and-swap promotion inside one storage transaction. Throws {@link StaleBaseError} when
   * `expectedHead` (or a candidate's base) is not the current head and {@link PromotionBlockedError}
   * when a required criterion lacks pass+completed. On success: parented System commit, head moved,
   * candidates promoted, sibling candidates rejected, Evolution promoted.
   */
  promoteTx(input: PromoteInput, prep: PreparedCommit): { commit: SystemCommit; rejected: string[]; advisories: GateItem[]; ended: EndedCredential[] } {
    return this.ctx.storage.transactionSync(() => {
      const head = this.kv("head");
      if (head !== input.expectedHead || head !== prep.head) throw new StaleBaseError(head);
      if (!input.candidateIds.length) throw new ConflictError("invalid-state", "no candidates to promote");
      const rows = input.candidateIds.map((id) => {
        const c = this.one("SELECT c.*, r.base_head, r.evolution_id, r.target, r.fork_repo FROM candidates c JOIN realizations r ON r.id = c.realization_id WHERE c.id = ?", id);
        if (!c) throw new ConflictError("not-found", `unknown candidate ${id}`);
        return c;
      });
      for (const c of rows) if (str(c.base_head) !== head) throw new StaleBaseError(head);
      for (const c of rows) {
        if (!OPEN_CANDIDATE.includes(String(c.state))) throw new ConflictError("invalid-state", `candidate ${c.id} is ${c.state}`);
      }
      if (rows.some((c) => c.target === "genome")) throw new UseAcceptError(rows.filter((c) => c.target === "genome").map((c) => String(c.id)));
      const composition = this.compositionProblems(rows, input.artifactId, prep.manifest);
      if (composition.length) throw new ConflictError("invalid-state", composition.join("; "));
      const { advisories, evidenceProviders } = this.checkGate(rows, input.gates, input.rationale);

      const ids = rows.map((c) => String(c.id));
      const evolutionIds = [...new Set(rows.map((c) => String(c.evolution_id)))];
      const marks = (xs: unknown[]) => xs.map(() => "?").join(",");
      const siblings = this.all(
        `SELECT c.id, c.realization_id FROM candidates c JOIN realizations r ON r.id = c.realization_id
         WHERE r.evolution_id IN (${marks(evolutionIds)}) AND c.id NOT IN (${marks(ids)}) AND c.state IN ('submitted','evaluated','selected')`,
        ...evolutionIds, ...ids,
      );
      const rejected = siblings.map((s) => String(s.id));
      const commit = this.writeCommit(prep, evolutionIds, {
        by: input.by, policy: "admin", rationale: input.rationale, candidates: ids, rejected, evidenceProviders,
        ...(advisories.length && { acknowledged: [...new Set(advisories.map((a) => a.criterion))] }),
      });
      const at = nowIso();
      const ended = new Set<string>();
      for (const c of rows) {
        this.sql.exec("UPDATE candidates SET state = 'promoted' WHERE id = ?", c.id);
        this.setRealizationStatus(String(c.realization_id), "promoted");
        ended.add(String(c.realization_id));
      }
      this.setKv("genome_commit", prep.manifest.genomeCommit);
      const app = prep.manifest.artifacts[input.artifactId];
      if (app) {
        this.setKv("app_source_repo", app.repo);
        this.setKv("app_source_commit", app.commit);
      }
      for (const s of siblings) {
        this.sql.exec("UPDATE candidates SET state = 'rejected' WHERE id = ?", s.id);
        const live = this.one("SELECT COUNT(*) AS n FROM candidates WHERE realization_id = ? AND state != 'rejected'", s.realization_id);
        if (Number(live?.n ?? 0) === 0) {
          this.setRealizationStatus(String(s.realization_id), "rejected");
          ended.add(String(s.realization_id));
        }
      }
      for (const e of evolutionIds) this.sql.exec("UPDATE evolutions SET status = 'promoted', decided_at = ? WHERE id = ?", at, e);
      return { commit, rejected, advisories, ended: this.endCredentials([...ended]) };
    });
  }

  async promote(input: PromoteInput): Promise<PromoteResult> {
    for(const cid of input.candidateIds){const c=this.candidate(cid);if(c&&this.realizationPlanId(c.realization))return {ok:false,code:'invalid-state',message:'Task candidates must promote through their integrated realization plan'};}

    try {
      const prep = await this.preparePromotion(input);
      const out = this.promoteTx(input, prep);
      this.emit({ type: "system.promoted", commit: out.commit });
      for (const e of out.commit.evolutions) {
        const evo = this.evolution(e);
        if (evo) this.emit({ type: "evolution.updated", evolution: evo });
      }
      for (const r of this.realizations()) {
        if ((r.updatedAt ?? "") >= (out.commit.createdAt ?? "")) this.emit({ type: "realization.updated", realization: r });
      }
      return { ok: true, ...out };
    } catch (e) {
      if (e instanceof StaleBaseError) return { ok: false, code: "stale-base", currentHead: e.currentHead };
      if (e instanceof PromotionBlockedError) return { ok: false, code: e.code, blocking: e.blocking, advisories: e.advisories };
      if (e instanceof GateUnavailableError) return { ok: false, code: "gate-unavailable", message: e.message };
      if (e instanceof UseAcceptError) return { ok: false, code: "use-accept", message: e.message };
      if (e instanceof ConflictError) return { ok: false, code: e.code, message: e.detail };
      throw e;
    }
  }

  /**
   * Null the realization secret of each realization promotion or acceptance ended (inside the caller's transaction),
   * as reject does. Returns their token ids for the Worker to revoke best-effort.
   */
  private endCredentials(realizationIds: string[]): EndedCredential[] {
    return realizationIds.map((id) => {
      const r = this.realizationRow(id);
      this.sql.exec("UPDATE realizations SET secret_hash = NULL WHERE id = ?", id);
      return { realizationId: id, forkRepo: String(r?.fork_repo ?? ""), tokenId: str(r?.token_id) };
    });
  }

  private latestCandidate(realizationId: string): Row | undefined {
    return this.one("SELECT * FROM candidates WHERE realization_id = ? ORDER BY rowid DESC LIMIT 1", realizationId);
  }

  /** Why `input`'s candidate is not the one to accept (null when it is the realization's latest, at that commit). */
  private staleCandidate(input: Pick<AcceptInput, "realizationId" | "candidateId" | "commit">, latest: Row): string | null {
    if (String(latest.id) !== input.candidateId) {
      return `candidate ${input.candidateId} is not the latest of ${input.realizationId} (the latest is ${latest.id}); reload the review`;
    }
    if (String(latest.commit_hash) !== input.commit) {
      return `candidate ${input.candidateId} is at ${String(latest.commit_hash).slice(0, 12)}, not ${input.commit.slice(0, 12)}; reload the review`;
    }
    return null;
  }

  /**
   * Admin acceptance of a Genome realization: the candidate the admin reviewed (`candidateId` at `commit`, which must
   * still be the realization's latest) becomes the canonical Genome (the fork becomes the Genome source), a System
   * commit records it, Evolutions are re-seeded. Idempotent: accepting an already-promoted realization's promoted
   * candidate again returns the current head commit.
   */
  async accept(input: AcceptInput): Promise<AcceptResult> {
    const rec = this.realization(input.realizationId);
    if (!rec) return { ok: false, code: "not-found", message: `unknown realization ${input.realizationId}` };
    if (rec.target !== "genome") return { ok: false, code: "invalid-state", message: "only genome realizations are accepted; promote app candidates" };
    const cand = this.latestCandidate(input.realizationId);
    if (!cand) return { ok: false, code: "invalid-state", message: "realization has no submitted candidate" };
    const stale = this.staleCandidate(input, cand);
    if (stale) return { ok: false, code: "stale-candidate", message: stale };
    if (rec.realization.status === "promoted") {
      const head = this.kv("head")!;
      return { ok: true, commit: this.systemCommit(head)!, realization: rec.realization, genomeCommit: this.kv("genome_commit")!, advisories: [], ended: [] };
    }
    if (TERMINAL_REALIZATION.includes(rec.realization.status)) return { ok: false, code: "invalid-state", message: `realization is ${rec.realization.status}` };
    const genomeCommit = String(cand.commit_hash);
    const prep = await this.prepareCommit(input, (prev) => ({
      genomeCommit, artifacts: { ...(prev?.artifacts ?? {}) }, templateVersions: {}, hookVersions: {},
    }));
    const evo = this.one("SELECT kind FROM evolutions WHERE id = ?", rec.evolutionId);
    let commit: SystemCommit;
    let advisories: GateItem[] = [];
    let ended: EndedCredential[] = [];
    try {
      commit = this.ctx.storage.transactionSync(() => {
        const head = this.kv("head");
        if (head !== prep.head) throw new StaleBaseError(head);
        // A submit may have landed while the commit was prepared: still the reviewed candidate?
        const latest = this.latestCandidate(input.realizationId);
        const moved = latest ? this.staleCandidate(input, latest) : "realization has no submitted candidate";
        if (moved) throw new StaleCandidateError(moved);
        // As in promote: the candidate must be built on the current head, so an amendment based on an older Genome
        // can never replace a newer genomeCommit that landed after its gate was prepared.
        if (str(this.realizationRow(input.realizationId)?.base_head) !== head) throw new StaleBaseError(head);
        // The same blocking gate as promotion, for the Genome candidate.
        const gate = this.checkGate([{ ...cand, evolution_id: rec.evolutionId }], { [String(cand.id)]: input.gates }, input.rationale);
        advisories = gate.advisories;
        const c = this.writeCommit(prep, [rec.evolutionId], {
          by: input.by, policy: "admin-accept", rationale: input.rationale, candidates: [String(cand.id)], evidenceProviders: gate.evidenceProviders,
          ...(advisories.length && { acknowledged: [...new Set(advisories.map((a) => a.criterion))] }),
        });
        this.setKv("genome_commit", genomeCommit);
        this.setKv("genome_source", rec.forkRepo);
        this.sql.exec("UPDATE candidates SET state = 'promoted' WHERE id = ?", cand.id);
        this.setRealizationStatus(input.realizationId, "promoted");
        ended = this.endCredentials([input.realizationId]);
        this.seedEvolutions(input.evolutions, genomeCommit);
        this.setEvolutionStatus(rec.evolutionId, evo?.kind === "mixed" ? "genome-approved" : "promoted", true);
        return c;
      });
    } catch (e) {
      if (e instanceof StaleBaseError) return { ok: false, code: "stale-base", message: e.message };
      if (e instanceof StaleCandidateError) return { ok: false, code: "stale-candidate", message: e.message };
      if (e instanceof PromotionBlockedError) return { ok: false, code: e.code, blocking: e.blocking, advisories: e.advisories };
      if (e instanceof GateUnavailableError) return { ok: false, code: "gate-unavailable", message: e.message };
      throw e;
    }
    const realization = this.realizationDto(this.realizationRow(input.realizationId)!);
    this.emit({ type: "genome.accepted", genomeCommit });
    this.emit({ type: "system.promoted", commit });
    this.emit({ type: "realization.updated", realization });
    const e = this.evolution(rec.evolutionId);
    if (e) this.emit({ type: "evolution.updated", evolution: e });
    return { ok: true, commit, realization, genomeCommit, advisories, ended };
  }

  /** Newest first. */
  history(): SystemCommit[] {
    return this.all("SELECT * FROM system_commits ORDER BY rowid DESC").map((r) => this.commitDto(r));
  }

  systemCommit(id: string): SystemCommit | null {
    const r = this.one("SELECT * FROM system_commits WHERE id = ?", id);
    return r ? this.commitDto(r) : null;
  }

  /** Candidates promoted into System commit `id` and its ancestors (the UI's `promotedCandidates` scope); [] when unknown. */
  promotedCandidates(id: string | null): string[] {
    const out = new Set<string>();
    const seen = new Set<string>();
    for (let cur = id; cur && !seen.has(cur);) {
      seen.add(cur);
      const r = this.one("SELECT parent, decision_json FROM system_commits WHERE id = ?", cur);
      if (!r) break;
      for (const c of json<{ candidates?: string[] }>(r.decision_json, {}).candidates ?? []) out.add(String(c));
      cur = str(r.parent);
    }
    return [...out];
  }

  /**
   * What a 40-hex revision names in this System: a candidate's commit (the newest such candidate), or a Genome commit
   * recorded in History or imported; null for any other commit (never read from Artifacts).
   */
  revisionOfCommit(sha: string): { candidate: string } | { genomeCommit: string } | null {
    const c = this.one("SELECT id FROM candidates WHERE commit_hash = ? ORDER BY rowid DESC LIMIT 1", sha);
    if (c) return { candidate: String(c.id) };
    if (this.kv("genome_commit") === sha || this.kv("imported_genome_commit") === sha) return { genomeCommit: sha };
    for (const r of this.all("SELECT manifest_json FROM system_commits")) {
      if (json<SystemManifest | null>(r.manifest_json, null)?.genomeCommit === sha) return { genomeCommit: sha };
    }
    return null;
  }

  // ---------------------------------------------------------------- events

  /** Record a delivery event id. Returns false if it was already seen. */
  markEventSeen(id: string): boolean {
    if (this.one("SELECT 1 AS x FROM events_seen WHERE event_id = ?", id)) return false;
    this.sql.exec("INSERT INTO events_seen (event_id, seen_at) VALUES (?, ?)", id, nowIso());
    return true;
  }

  /** Fan out an event computed in the Worker (e.g. conflicts) to SSE clients. */
  publish(event: SseEvent): void {
    this.emit(event);
  }

  // ---------------------------------------------------------------- B3 builds
  // Builds, deployments and per-fork event subscriptions. Logic lives in BuildsStore; these delegate and emit SSE.

  private buildsStore: BuildsStore | undefined;
  private builds_(): BuildsStore {
    return (this.buildsStore ??= new BuildsStore(this.sql));
  }

  /** Upsert a build row (idempotent; see BuildsStore.upsertBuild); emits `build.updated` when something changed. */
  upsertBuild(input: BuildUpsert): { build: Build; changed: boolean } {
    const out = this.builds_().upsertBuild(input);
    if (out.changed) this.emit({ type: "build.updated", build: out.build });
    return out;
  }
  build(id: string): Build | null { return this.builds_().build(id); }
  builds(filter: { realization?: string; candidate?: string; commit?: string; kind?: BuildKind; limit?: number } = {}): Build[] { return this.builds_().builds(filter); }
  latestBuild(commit: string, kind?: BuildKind): BuildSummary | null { return this.builds_().latestBuild(commit, kind); }
  /** Latest build per candidate id, for attaching `Candidate.build`. */
  candidateBuilds(cands: { id: string; realization: string; commit: string }[]): Record<string, BuildSummary> {
    const out: Record<string, BuildSummary> = {};
    for (const c of cands) {
      const b = this.builds_().candidateBuild(c.id, c.realization, c.commit);
      if (b) out[c.id] = b;
    }
    return out;
  }

  private emitDeployments(ds: Deployment[]): void {
    for (const deployment of ds) this.emit({ type: "deployment.updated", deployment });
  }
  createDeployment(input: DeploymentInput): Deployment {
    const out = this.builds_().createDeployment(input);
    this.emitDeployments([out.deployment, ...out.superseded]);
    return out.deployment;
  }
  setDeploymentResult(id: string, result: { status?: "live" | "failed"; buildRow?: string; url?: string; buildId?: string; realizedArtifactId?: string }): Deployment | null {
    const out = this.builds_().setDeploymentResult(id, result);
    if (out?.changed) this.emitDeployments([out.deployment, ...out.superseded]);
    return out?.deployment ?? null;
  }
  realizedArtifactForBuild(buildRow: string): RealizedArtifact | null { return this.builds_().realizedArtifactForBuild(buildRow); }
  realizedArtifact(id: string): RealizedArtifact | null { return this.builds_().realizedArtifact(id); }
  realizedArtifacts(): RealizedArtifact[] { return this.builds_().realizedArtifacts(); }
  deployment(id: string): Deployment | null { return this.builds_().deployment(id); }
  deployments(filter: { kind?: BuildKind; limit?: number } = {}): Deployment[] { return this.builds_().deployments(filter); }
  liveProduction(): Deployment | null { return this.builds_().liveProduction(); }
  setDeploymentIngestHash(id: string, hash: string): Deployment | null { return this.builds_().setIngestTokenHash(id, hash); }
  deploymentByIngestHash(hash: string): Deployment | null { return this.builds_().deploymentByIngestHash(hash); }
  /** `latestBuild`, `deployment` and `deployState` for {@link summary}. */
  buildsSummary(appCommit: string | null | undefined): BuildsSummaryPart { return this.builds_().summaryPart(appCommit); }

  /** The Artifacts event subscription feeding this realization's fork pushes to the queue (null when none). */
  realizationSubscription(id: string): string | null {
    return str(this.one("SELECT subscription_id FROM realizations WHERE id = ?", id)?.subscription_id);
  }
  setRealizationSubscription(id: string, subscriptionId: string | null): void {
    this.sql.exec("UPDATE realizations SET subscription_id = ? WHERE id = ?", subscriptionId, id);
  }

  // ---------------------------------------------------------------- end B3 builds

  // ---------------------------------------------------------------- B5 summary
  // Home-page summary fields and signifiers, `system.updated`, and describe-a-change Evolutions.

  private readinessMemo = new Map<string, { errors: number; missing: number }>();

  /** Error/missing finding counts of the cached rules readiness at `genomeCommit`; undefined until it is cached. */
  private readinessCounts(genomeCommit: string): { errors: number; missing: number } | undefined {
    const hit = this.readinessMemo.get(genomeCommit);
    if (hit) return hit;
    const raw = this.getModelCache(genomeCommit, "rules");
    if (!raw) return undefined;
    // Counted as the readiness report counts blockers: a provisional node's `missing` finding does not block.
    const blocking = ((JSON.parse(raw) as { findings?: { level: string; rule: string }[] }).findings ?? []).filter(isBlocking);
    const out = { errors: blocking.filter((f) => f.level === "error").length, missing: blocking.filter((f) => f.level === "missing").length };
    this.readinessMemo.set(genomeCommit, out);
    return out;
  }

  private count(q: string, ...args: SqlStorageValue[]): number {
    return Number(this.one(q, ...args)?.n ?? 0);
  }

  private summaryExtras(s: HeadState): Omit<SystemSummary, "systemId" | "title" | "head" | "genomeRepo" | "appRepo" | "genomeCommit" | "phase" | "evolutionCounts" | "updatedAt"> {
    const builds = this.buildsSummary(s.appSource?.commit);
    // Implementation Tasks are reviewed in Work; only Evolution-owned rows belong to the legacy Review inbox.
    const inStatus = (xs: string[], includeTasks = false) => this.count(`SELECT COUNT(*) AS n FROM realizations WHERE ${includeTasks ? "" : "task_plan_id IS NULL AND "}status IN (${xs.map(() => "?").join(",")})`, ...xs);
    const realizationCounts = {
      evolving: inStatus(["claimed", "working", "evaluating"], true),
      pending: inStatus(["submitted", "evaluated", "selected"]),
      awaitingAdmin: inStatus(["awaiting-admin"]),
      // "Waiting for you" (the SPA's Review count uses the same set): open app candidates plus Genome amendments.
      awaitingReview: inStatus(["submitted", "evaluated", "selected", "awaiting-admin"]),
    };
    const openCandidates = this.count(`SELECT COUNT(*) AS n FROM candidates WHERE state IN ('submitted','evaluated','selected')`);
    const evaluatedOpen = this.count(`SELECT COUNT(*) AS n FROM candidates WHERE state IN ('evaluated','selected')`);
    const actionableIdle = this.count(`SELECT COUNT(*) AS n FROM evolutions e WHERE e.status = 'actionable'
      AND NOT EXISTS (SELECT 1 FROM realizations r WHERE r.evolution_id = e.id)`);
    const everCandidates = this.count("SELECT COUNT(*) AS n FROM candidates");
    const built = this.count(`SELECT COUNT(*) AS n FROM candidates c JOIN realizations r ON r.id = c.realization_id
      WHERE c.state = 'promoted' AND r.target = 'app'`) > 0;
    const ph = this.one("SELECT COUNT(*) AS n, MAX(emitted_at) AS emitted, MAX(received_at) AS received FROM phenome_events");
    const phenome = { events: Number(ph?.n ?? 0), ...(ph?.emitted != null && { lastEmittedAt: String(ph.emitted) }) };
    const readiness = this.readinessCounts(s.genomeCommit);
    const observed = ph?.received != null && Date.now() - Date.parse(String(ph.received)) < 24 * 3600_000;

    const signifiers: Signifier[] = [];
    if (realizationCounts.evolving) signifiers.push("evolving");
    if (evaluatedOpen || actionableIdle) signifiers.push("pending-realization");
    if (realizationCounts.awaitingAdmin) signifiers.push("awaiting-admin");
    if (!built || (readiness && readiness.errors + readiness.missing > 0)) signifiers.push("not-fully-built");
    if (built) signifiers.push("built");
    if (builds.deployState === "live") signifiers.push("deployed");
    if (builds.deployState === "behind") signifiers.push("behind");
    if (observed) signifiers.push("observed");
    if (s.phase === "unrealized" && everCandidates === 0) signifiers.push("unrealized");
    const plans = planCounts(this.lifecycle().list());
    const importReview = this.importReviews().summary();
    if (importReview?.status === "pending") signifiers.push("import-pending");
    if (plans.awaitingAgent) signifiers.push("tasks-awaiting-agent");
    if (plans.integrated) signifiers.push("plan-awaiting-promotion");

    return {
      ...(s.appSource?.commit && { appCommit: s.appSource.commit }),
      built, realizationCounts, openCandidates, ...builds, phenome, ...(readiness && { readiness }), signifiers,
      planCounts: plans, ...(importReview && { importReview }),
    };
  }

  /** The current summary, announced as `system.updated` (the Worker then copies it into the registry). */
  publishSummary(): SystemSummary | null {
    const summary = this.summary();
    if (summary) this.emit({ type: "system.updated", system: summary });
    return summary;
  }

  /** Describe-a-change: a new `actionable` Evolution with the next free `evolution.N` id; emits `evolution.created`. */
  createEvolution(input: Omit<EvolutionSeed, "id" | "state">): Evolution {
    if(input.kind!=='genome-amendment')throw new ConflictError('invalid-state','New Evolutions change only the Genome; use a realization plan for implementation');
    if (!this.state()) throw new ConflictError("not-found", "System not imported");
    return this.ctx.storage.transactionSync(() => {
      let n = 0;
      for (const r of this.all("SELECT id FROM evolutions")) {
        const m = /^evolution\.(\d+)$/.exec(String(r.id));
        if (m) n = Math.max(n, Number(m[1]));
      }
      const id = `evolution.${n + 1}`;
      this.seedEvolutions([{ ...input, id, state: "actionable" }], this.kv("genome_commit") ?? "");
      const evolution = this.evolution(id)!;
      this.emit({ type: "evolution.created", evolution });
      return evolution;
    });
  }

  setEvolutionAffectedNodes(eid:string,nodes:string[]):Evolution {const r=this.one('SELECT * FROM evolutions WHERE id=?',eid);if(!r)throw new ConflictError('not-found','unknown Evolution');const e=json<EvolutionSeed>(r.scope_json,{} as EvolutionSeed);e.affectedNodes=nodes;this.sql.exec('UPDATE evolutions SET affected_nodes=?,scope_json=? WHERE id=?',JSON.stringify(nodes),JSON.stringify(e),eid);return this.evolution(eid)!;}
  // ---------------------------------------------------------------- end B5 summary

  // ---------------------------------------------------------------- B2 changelog

  private changelogStore: ChangelogStore | undefined;
  private changelog(): ChangelogStore {
    return (this.changelogStore ??= new ChangelogStore(this.sql));
  }
  changelogCached(commitId: string): CachedChangelog | null { return this.changelog().get(commitId); }
  changelogRows(commitIds: string[]): Record<string, string> { return this.changelog().rows(commitIds); }
  putChangelog(commitId: string, row: string, entry: string | null): void { this.changelog().put(commitId, row, entry); }

  // ---------------------------------------------------------------- end B2 changelog

  // ---------------------------------------------------------------- W7 intent proposals

  private proposalsStore: ProposalsStore | undefined;
  private proposals(): ProposalsStore {
    return (this.proposalsStore ??= new ProposalsStore(this.sql));
  }
  private proposalPlans(): ProposalPlanStore { return new ProposalPlanStore(this.sql); }
  /** Stored proposals carry `plan` and `deferredFrom` from the plan columns (`[]` for rows older than plans). */
  proposal(id: string): StoredProposal | null {
    const s = this.proposals().get(id);
    return s && { ...s, proposal: this.proposalPlans().decorate(s.proposal) };
  }
  /** Creates the row and its plan columns (`plan` default `[]`, `deferredFrom`) in one transaction. */
  createProposal(proposal: Omit<Proposal, "id" | "plan"> & { plan?: ProposalPlanNode[] }): Proposal {
    return this.ctx.storage.transactionSync(() => {
      const created = this.proposals().create({ ...proposal, plan: proposal.plan ?? [] });
      this.proposalPlans().init(created.id, created.plan, proposal.deferredFrom);
      return this.proposalPlans().decorate(created);
    });
  }
  stageProposal(id:string,claimedAt:string,approval:NonNullable<Proposal['stagedApproval']>):boolean{return this.proposals().stage(id,claimedAt,approval);}
  /** A revision that carries a `plan` array also replaces the stored tree (decisions are kept), in the same transaction. */
  reviseProposal(proposal: Proposal, turns: ProposalTurn[]): ReviseResult {
    return this.ctx.storage.transactionSync(() => {
      const out = this.proposals().revise(proposal, turns);
      if (!("revised" in out)) return out;
      if (Array.isArray(proposal.plan)) this.proposalPlans().setTree(proposal.id, proposal.plan);
      return { revised: this.proposalPlans().decorate(out.revised) };
    });
  }
  /** Starts an accept: open → accepting, only while the head Genome is the one the proposal was computed on. */
  claimProposal(id: string): ClaimResult {
    const s = this.state();
    if (!s) throw new ConflictError("not-found", "System not imported");
    const out = this.proposals().claim(id, s.genomeCommit);
    return "claimed" in out ? { ...out, claimed: this.proposalPlans().decorate(out.claimed) } : out;
  }
  releaseProposal(id: string, claimedAt: string, error: string | null): boolean { return this.proposals().release(id, claimedAt, error); }
  /** `open` or `accepting` → `abandoned` (the import review's removal amendment after a failed accept). Emits nothing. */
  abandonProposal(id: string): boolean { return this.proposals().abandon(id); }
  finishProposal(id: string, claimedAt: string, ids: AcceptedIds, error?: string): Proposal | null {
    const p = this.proposals().finish(id, claimedAt, ids, error);
    return p && this.proposalPlans().decorate(p);
  }
  /** Agreement tree, explicit decisions and deferral source (storage only); null for an unknown proposal. */
  proposalPlan(id: string): StoredProposalPlan | null { return this.proposalPlans().get(id); }
  /**
   * Stores tree and decisions (and `deferredFrom` when given) in one conditional UPDATE while the proposal is `open`
   * and, with `expected`, its decisions are still exactly `expected` (compare-and-set); false when it is `accepting`,
   * accepted, abandoned, unknown or its decisions changed. Emits nothing.
   */
  setProposalPlan(id: string, plan: ProposalPlanNode[], decisions: ProposalDecisions, deferredFrom?: string, expected?: ProposalDecisions): boolean {
    return this.proposalPlans().set(id, plan, decisions, deferredFrom, expected);
  }
  /**
   * Moves an open deferred proposal with no staged approval from base Genome `oldBase` to `newBase` (the Worker has
   * re-validated its ops on `newBase`). One conditional UPDATE; false when any condition fails. Emits nothing.
   */
  rebaseProposal(id: string, oldBase: string, newBase: string): boolean { return this.proposalPlans().rebase(id, oldBase, newBase); }

  /**
   * Undo an accept that failed after creating its Evolution: delete the Evolution with its realizations and what they
   * recorded (checkpoints, candidates, evaluations), so a retry leaves exactly one. Realization numbers stay used, so
   * fork names never repeat. Returns the realizations' credentials for the Worker to revoke and unregister. Refuses
   * (`invalid-state`, nothing deleted) once any of it was promoted or a System commit names the Evolution.
   */
  discardEvolution(id: string): EndedCredential[] {
    return this.ctx.storage.transactionSync(() => {
      const rows = this.all("SELECT id, fork_repo, token_id, status FROM realizations WHERE evolution_id = ?", id);
      const promoted = rows.some((r) => String(r.status) === "promoted")
        || rows.some((r) => this.one("SELECT 1 FROM candidates WHERE realization_id = ? AND state = 'promoted'", String(r.id)))
        || this.all("SELECT evolution_ids FROM system_commits").some((c) => (JSON.parse(String(c.evolution_ids)) as string[]).includes(id));
      if (promoted) throw new ConflictError("invalid-state", `evolution ${id} is part of the System's history and cannot be discarded`);
      for (const r of rows) {
        const rid = String(r.id);
        for (const c of this.all("SELECT id FROM candidates WHERE realization_id = ?", rid)) {
          for (const t of ["evaluations", "candidate_reviews", "conflict_runs", "evaluation_claims"]) this.sql.exec(`DELETE FROM ${t} WHERE candidate_id = ?`, String(c.id));
        }
        this.sql.exec("DELETE FROM builds WHERE realization_id = ? OR candidate_id IN (SELECT id FROM candidates WHERE realization_id = ?)", rid, rid);
        this.sql.exec("DELETE FROM candidates WHERE realization_id = ?", rid);
        this.sql.exec("DELETE FROM checkpoints WHERE realization_id = ?", rid);
        this.sql.exec("DELETE FROM realizations WHERE id = ?", rid);
      }
      this.sql.exec("DELETE FROM evolutions WHERE id = ?", id);
      return rows.map((r) => ({ realizationId: String(r.id), forkRepo: String(r.fork_repo), tokenId: str(r.token_id) ?? null }));
    });
  }

  // ---------------------------------------------------------------- end W7 intent proposals

  // ---------------------------------------------------------------- System import review (backend.md B.10)

  private importReviews(): ImportReviewStore { return new ImportReviewStore(this.sql); }
  /** The stored System import review; null when the System has none. */
  importReview(): SystemImportReview | null { return this.importReviews().get(); }
  /**
   * Replaces the review (null clears it) in one transaction. When a row was written or deleted it emits
   * `system.import-review` (`status`, or null on clear) and then `system.updated`.
   */
  setImportReview(review: SystemImportReview | null): SystemImportReview | null {
    const changed = this.ctx.storage.transactionSync(() => this.importReviews().set(review));
    if (changed) {
      this.emit({ type: "system.import-review", status: review?.status ?? null });
      this.publishSummary();
    }
    return review;
  }
  /**
   * Compare-and-set in one transaction: stores `next` only while the stored review has `expectedStatus` and
   * `expectedGenomeCommit`, so concurrent accepts flip pending to accepted once, and an accept never overwrites a review
   * a forced re-import opened meanwhile. Emits `system.import-review` and `system.updated` only on success.
   */
  casImportReview(expectedStatus: SystemImportReviewStatus, expectedGenomeCommit: string, next: SystemImportReview): boolean {
    const done = this.ctx.storage.transactionSync(() => this.importReviews().cas(expectedStatus, expectedGenomeCommit, next));
    if (!done) return false;
    this.emit({ type: "system.import-review", status: next.status });
    this.publishSummary();
    return true;
  }

  // ---------------------------------------------------------------- registry (instance `__registry` only)

  private registryStore: RegistryStore | undefined;

  /** The registry lives only in the `__registry` instance; System instances refuse registry calls. */
  private registry(): RegistryStore {
    if (this.ctx.id.name !== REGISTRY) throw new ConflictError("invalid-state", "registry calls go to the __registry instance");
    return (this.registryStore ??= new RegistryStore(this.sql));
  }

  registerSystem(summary: SystemSummary): void { this.registry().registerSystem(summary); }
  listSystems(): SystemSummary[] { return this.registry().listSystems(); }
  /** Whether `systemId` was imported (reads of other ids are refused before their DO is touched). */
  hasSystem(systemId: string): boolean { return this.registry().hasSystem(systemId); }
  unregisterSystem(systemId: string): void { this.registry().unregisterSystem(systemId); }
  registerRealization(realizationId: string, systemId: string, evolutionId: string, forkRepo: string): void {
    this.registry().registerRealization(realizationId, systemId, evolutionId, forkRepo);
  }
  unregisterRealization(systemId: string, realizationId: string): void { this.registry().unregisterRealization(systemId, realizationId); }
  resolveRealization(realizationId: string) { return this.registry().resolveRealization(realizationId); }
  /** Fork repo name → owning realization (queue `resolveFork`). */
  resolveFork(forkRepo: string) { return this.registry().resolveFork(forkRepo); }

  // B4 phenome
  private phenomeStore: PhenomeStore | undefined;
  private phenome(): PhenomeStore { return (this.phenomeStore ??= new PhenomeStore(this.sql)); }
  phenomePrincipal(digest: string): PhenomePrincipal | null { return this.phenome().principalForHash(digest); }
  /** Store validated events and announce them on the SSE stream; returns, per row, whether it was new. */
  phenomeIngest(rows: PhenomeRow[], realizationId: string | null, verifyDeployment = false): boolean[] {
    const out = this.phenome().insert(rows, realizationId, verifyDeployment);
    const fresh = rows.map((r, i) => ({ r, ...out[i] })).filter((x) => x.fresh);
    if (fresh.length) {
      const last = fresh[fresh.length - 1];
      this.emit({ type: "phenome.ingested", count: fresh.length, ...(last.deploymentId && { deploymentId: last.deploymentId }), commit: last.r.commit });
    }
    return out.map((x) => x.fresh);
  }
  phenomeEvents(systemId: string, query: PhenomeEventsQuery = {}): PhenomeEventsResponse { return this.phenome().list(systemId, query); }
}

