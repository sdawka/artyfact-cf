import { DurableObject } from "cloudflare:workers";
import type { GateCriterion } from "../promotion";
import type {
  Candidate, Checkpoint, ConflictReport, Evaluation, GateItem, Evolution, EvolutionState, Realization, RealizationStatus, SseEnvelope, SseEvent,
  SystemCommit, SystemManifest, SystemSummary, TaskPacket, WorkResponse,
} from "../../shared/api";
import { canonicalJson, evolutionShort, nowIso, sha256Hex } from "../util";
import { RegistryStore } from "./registry";
import { SCHEMA } from "./schema";

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

/** Thrown by RPC methods; the `[code]` message prefix survives RPC so the Worker can map it to HTTP. */
export class ConflictError extends Error {
  constructor(readonly code: "not-found" | "invalid-state", readonly detail: string) {
    super(`[${code}] ${detail}`);
    this.name = "ConflictError";
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
}

export interface BootstrapInput extends ManifestExtras {
  systemId: string;
  title: string;
  phase?: string;
  genomeRepo: string;
  appRepo: string;
  genomeCommit: string;
  appCommit: string;
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
  appSource: { repo: string; commit: string };
  manifest: SystemManifest | null;
}

export interface ReserveInput {
  evolutionId: string;
  target: "app" | "genome";
  agentLabel?: string;
  role?: Realization["agent"]["role"];
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

export type PromoteResult =
  | { ok: true; commit: SystemCommit; rejected: string[]; advisories: GateItem[] }
  | { ok: false; code: "stale-base"; currentHead: string | null }
  | { ok: false; code: "blocked" | "advisories-unacknowledged"; blocking: GateItem[]; advisories: GateItem[] }
  | { ok: false; code: ConflictError["code"] | "gate-unavailable"; message: string };

export interface AcceptInput extends ManifestExtras {
  realizationId: string;
  rationale: string;
  by: string;
  evolutions: EvolutionSeed[];
}

export type AcceptResult =
  | { ok: true; commit: SystemCommit; realization: Realization; genomeCommit: string }
  | { ok: false; code: "not-found" | "invalid-state" | "stale-base"; message: string };

export interface PreparedCommit { head: string | null; manifest: SystemManifest; manifestHash: string }

type Row = Record<string, SqlStorageValue>;
const str = (v: SqlStorageValue | undefined) => (v == null ? null : String(v));
const json = <T>(v: SqlStorageValue | undefined, fallback: T): T => (v == null || v === "" ? fallback : (JSON.parse(String(v)) as T));



const OPEN_CANDIDATE = ["submitted", "evaluated", "selected"];
const TERMINAL_REALIZATION: RealizationStatus[] = ["promoted", "rejected", "abandoned"];
const PING_MS = 15_000;
const enc = new TextEncoder();

/** One instance per System: canonical state, realizations, candidates, evaluations and promotion (CAS). */
export class SystemAuthority extends DurableObject<Env> {
  private sql: SqlStorage;
  private clients = new Set<WritableStreamDefaultWriter<Uint8Array>>();
  private pinger: ReturnType<typeof setInterval> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) this.sql.exec(stmt);
  }

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
      appSource: { repo: this.kv("app_source_repo") ?? this.kv("app_repo")!, commit: this.kv("app_source_commit")! },
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
    };
  }

  private async prepareCommit(extras: ManifestExtras, patch: (prev: SystemManifest | null) => SystemManifest): Promise<PreparedCommit> {
    const head = this.kv("head");
    const manifest = patch(this.readManifest(head));
    manifest.templateVersions = extras.templateVersions;
    manifest.hookVersions = extras.hookVersions;
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
      },
      createdAt: String(r.created_at),
    };
  }

  /**
   * Import: record repos + head commits, write the root System commit (or a new one when the imported
   * commits changed) and seed Evolutions. Idempotent for the same commits.
   */
  /** Returns `{ alreadyImported }` (not a throw) when re-pointing an imported System without `force`. */
  async bootstrap(input: BootstrapInput): Promise<SystemSummary | { alreadyImported: string }> {
    // Compare with what was last imported (not the current head), so re-importing unchanged repos after a
    // promotion keeps the promoted state.
    const imported = [this.kv("genome_repo"), this.kv("imported_genome_commit"), this.kv("app_repo"), this.kv("imported_app_commit")];
    const unchanged = imported.join("|") === [input.genomeRepo, input.genomeCommit, input.appRepo, input.appCommit].join("|");
    if (!unchanged && imported[0] !== null && !input.force) {
      return { alreadyImported: `system ${input.systemId} is already imported from ${imported[0]}@${String(imported[1]).slice(0, 7)} + ${imported[2]}@${String(imported[3]).slice(0, 7)}; pass force to re-point it` };
    }
    return this.applyImport(input, unchanged);
  }

  private async applyImport(input: BootstrapInput, unchanged: boolean): Promise<SystemSummary> {
    const prep = unchanged ? null : await this.prepareCommit(input, () => ({
      genomeCommit: input.genomeCommit,
      artifacts: { [input.artifactId]: { repo: input.appRepo, commit: input.appCommit } },
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
        this.writeCommit(prep, [], {
          by: "platform", policy: "import",
          rationale: `import ${input.genomeRepo}@${input.genomeCommit.slice(0, 7)} + ${input.appRepo}@${input.appCommit.slice(0, 7)}`,
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

  /** Cache JSON parts (`files`, `bundle`, `readiness`) for a Genome commit. Each part is one row (< 2 MB). */
  putModelCache(genomeCommit: string, parts: Record<string, string>): void {
    const at = nowIso();
    for (const [part, text] of Object.entries(parts)) {
      this.sql.exec("INSERT OR REPLACE INTO model_cache (genome_commit, part, json, created_at) VALUES (?, ?, ?, ?)", genomeCommit, part, text, at);
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
    return str(this.one("SELECT json FROM model_cache WHERE genome_commit = ? AND part = ?", genomeCommit, part)?.json);
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
    };
  }

  private setRealizationStatus(id: string, status: RealizationStatus): void {
    this.sql.exec("UPDATE realizations SET status = ?, updated_at = ? WHERE id = ?", status, nowIso(), id);
  }

  /**
   * Allocate the next realization number (System-wide, so fork names never collide across Evolutions)
   * and record it as `claimed`. The Worker then forks, issues a token and calls {@link activateRealization}.
   */
  reserveRealization(input: ReserveInput): ReservedRealization {
    const s = this.state();
    if (!s) throw new ConflictError("not-found", "System not imported");
    return this.ctx.storage.transactionSync(() => {
      const evo = this.one("SELECT status FROM evolutions WHERE id = ?", input.evolutionId);
      if (!evo) throw new ConflictError("not-found", `unknown evolution ${input.evolutionId}`);
      if (["promoted", "rejected", "withdrawn"].includes(String(evo.status))) {
        throw new ConflictError("invalid-state", `evolution ${input.evolutionId} is ${evo.status}`);
      }
      const n = Number(this.kv("realization_seq") ?? 0) + 1;
      this.setKv("realization_seq", String(n));
      const id = `realization.${evolutionShort(input.evolutionId)}.r${n}`;
      const namingRepo = input.target === "genome" ? s.genomeRepo : s.appRepo;
      const baseRepo = input.target === "genome" ? s.genomeSource : s.appSource.repo;
      const baseCommit = input.target === "genome" ? s.genomeCommit : s.appSource.commit;
      const forkRepo = `${namingRepo}--r${n}`;
      const at = nowIso();
      this.sql.exec(
        `INSERT INTO realizations (id, evolution_id, n, target, fork_repo, base_commit, agent_label, status, created_at, updated_at, base_repo, base_head, role)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'claimed', ?, ?, ?, ?, ?)`,
        id, input.evolutionId, n, input.target, forkRepo, baseCommit, input.agentLabel ?? null, at, at, baseRepo, s.head, input.role ?? "implementer",
      );
      if (["proposed", "genome-approved", "actionable"].includes(String(evo.status))) this.setEvolutionStatus(input.evolutionId, "realizing");
      return { realization: this.realizationDto(this.realizationRow(id)!), baseRepo, baseCommit, forkRepo };
    });
  }

  /** Store token metadata (never the plaintext) and the packet; emits `realization.created`. */
  activateRealization(id: string, input: { tokenId: string; tokenExpires: string; remote: string; packet: TaskPacket }): Realization {
    this.sql.exec(
      "UPDATE realizations SET token_id = ?, token_expires = ?, remote = ?, packet_json = ?, packet_hash = ?, updated_at = ? WHERE id = ?",
      input.tokenId, input.tokenExpires, input.remote, JSON.stringify(input.packet), input.packet.hash, nowIso(), id,
    );
    const r = this.realizationDto(this.realizationRow(id)!);
    this.emit({ type: "realization.created", realization: r });
    const evo = this.evolution(r.evolution);
    if (evo) this.emit({ type: "evolution.updated", evolution: evo });
    return r;
  }

  abandonRealization(id: string): void {
    this.setRealizationStatus(id, "abandoned");
  }

  /** Admin rejection (e.g. a Genome amendment): realization and its open candidates → rejected, reason kept. */
  rejectRealization(id: string, reason: string): Realization {
    const r = this.realizationRow(id);
    if (!r) throw new ConflictError("not-found", `unknown realization ${id}`);
    if (["promoted", "accepted"].includes(String(r.status))) throw new ConflictError("invalid-state", `realization ${id} is ${r.status}`);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE realizations SET status = 'rejected', rejection_reason = ?, updated_at = ? WHERE id = ?", reason, nowIso(), id);
      this.sql.exec("UPDATE candidates SET state = 'rejected' WHERE realization_id = ? AND state != 'promoted'", id);
    });
    const dto = this.realizationDto(this.realizationRow(id)!);
    this.emit({ type: "realization.updated", realization: dto });
    return dto;
  }

  /** Append a checkpoint; a repeat of the last (summary, commit) is a no-op. claimed → working. */
  checkpoint(id: string, input: { summary: string; commit?: string }): { realization: Realization; checkpoint: Checkpoint } {
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
    const id = `candidate.${evolutionShort(String(r.evolution_id))}.r${r.n}.${input.commit.slice(0, 7)}`;
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
   * Upsert evaluations (one row per candidate × criterion × hook), move the candidate to `evaluated`
   * and its realization to `status` (evaluated, or awaiting-admin for Genome candidates).
   */
  recordEvaluations(candidateId: string, evaluations: Evaluation[], status?: RealizationStatus): Evaluation[] {
    const cand = this.one("SELECT * FROM candidates WHERE id = ?", candidateId);
    if (!cand) throw new ConflictError("not-found", `unknown candidate ${candidateId}`);
    const stored: Evaluation[] = [];
    this.ctx.storage.transactionSync(() => {
      for (const e of evaluations) {
        const at = e.finishedAt ?? e.startedAt ?? nowIso();
        const hook = e.hook || "none";
        const id = e.id || `${candidateId}:${hook}:${e.criterion}`;
        const { id: _i, candidate: _c, criterion: _k, hook: _h, execution: _x, verdict: _v, observations, verifier: _vf, ...extra } = e;
        this.sql.exec("DELETE FROM evaluations WHERE candidate_id = ? AND criterion_id = ? AND hook_id = ?", candidateId, e.criterion, hook);
        this.sql.exec(
          "INSERT OR REPLACE INTO evaluations (id, candidate_id, criterion_id, hook_id, execution, verdict, observations_json, evidence_key, verifier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          id, candidateId, e.criterion, hook, e.execution, e.verdict, JSON.stringify({ observations: observations ?? [], extra }),
          null, e.verifier ?? "artyfact-platform", at,
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
    for (const { id: criterion, severity } of gates) {
      const rows = this.all("SELECT verdict, execution FROM evaluations WHERE candidate_id = ? AND criterion_id = ?", candidateId, criterion);
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

  /** Compose the next manifest for promoting `candidateIds` and hash it (async, so outside the transaction). */
  async preparePromotion(input: PromoteInput): Promise<PreparedCommit> {
    const cands = input.candidateIds.map((id) => this.one(
      "SELECT c.commit_hash, r.fork_repo, r.target FROM candidates c JOIN realizations r ON r.id = c.realization_id WHERE c.id = ?", id,
    ));
    return this.prepareCommit(input, (prev) => {
      const artifacts = { ...(prev?.artifacts ?? {}) };
      let genomeCommit = prev?.genomeCommit ?? this.kv("genome_commit") ?? "";
      for (const c of cands) {
        if (!c) continue;
        if (c.target === "genome") genomeCommit = String(c.commit_hash);
        else artifacts[input.artifactId] = { repo: String(c.fork_repo), commit: String(c.commit_hash) };
      }
      return { genomeCommit, artifacts, templateVersions: {}, hookVersions: {} };
    });
  }

  /**
   * Compare-and-swap promotion inside one storage transaction. Throws {@link StaleBaseError} when
   * `expectedHead` (or a candidate's base) is not the current head and {@link PromotionBlockedError}
   * when a required criterion lacks pass+completed. On success: parented System commit, head moved,
   * candidates promoted, sibling candidates rejected, Evolution promoted.
   */
  promoteTx(input: PromoteInput, prep: PreparedCommit): { commit: SystemCommit; rejected: string[]; advisories: GateItem[] } {
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
      const items: GateItem[] = [];
      const blockingIds = new Set<string>();
      for (const c of rows) {
        const gates = this.effectiveGates(c, input.gates[String(c.id)]);
        items.push(...this.gateItems(String(c.id), gates));
        for (const g of gates) if (g.blocking) blockingIds.add(`${c.id}|${g.id}`);
      }
      const blocking = items.filter((i) => blockingIds.has(`${i.candidate}|${i.criterion}`));
      const advisories = items.filter((i) => !blockingIds.has(`${i.candidate}|${i.criterion}`));
      if (blocking.length) throw new PromotionBlockedError("blocked", blocking, advisories);
      if (advisories.length && !input.rationale.trim()) throw new PromotionBlockedError("advisories-unacknowledged", [], advisories);

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
        by: input.by, policy: "admin", rationale: input.rationale, candidates: ids, rejected,
        ...(advisories.length && { acknowledged: [...new Set(advisories.map((a) => a.criterion))] }),
      });
      const at = nowIso();
      for (const c of rows) {
        this.sql.exec("UPDATE candidates SET state = 'promoted' WHERE id = ?", c.id);
        this.setRealizationStatus(String(c.realization_id), "promoted");
      }
      this.setKv("genome_commit", prep.manifest.genomeCommit);
      // A promoted Genome candidate's commit lives in its fork: move the Genome source with it (as accept does).
      const genomeRow = rows.find((c) => c.target === "genome" && String(c.commit_hash) === prep.manifest.genomeCommit);
      if (genomeRow) this.setKv("genome_source", String(genomeRow.fork_repo));
      const app = prep.manifest.artifacts[input.artifactId];
      if (app) {
        this.setKv("app_source_repo", app.repo);
        this.setKv("app_source_commit", app.commit);
      }
      for (const s of siblings) {
        this.sql.exec("UPDATE candidates SET state = 'rejected' WHERE id = ?", s.id);
        const live = this.one("SELECT COUNT(*) AS n FROM candidates WHERE realization_id = ? AND state != 'rejected'", s.realization_id);
        if (Number(live?.n ?? 0) === 0) this.setRealizationStatus(String(s.realization_id), "rejected");
      }
      for (const e of evolutionIds) this.sql.exec("UPDATE evolutions SET status = 'promoted', decided_at = ? WHERE id = ?", at, e);
      return { commit, rejected, advisories };
    });
  }

  async promote(input: PromoteInput): Promise<PromoteResult> {
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
      if (e instanceof ConflictError) return { ok: false, code: e.code, message: e.detail };
      throw e;
    }
  }

  /**
   * Admin acceptance of a Genome realization: its latest candidate commit becomes the canonical Genome
   * (the fork becomes the Genome source), a System commit records it, Evolutions are re-seeded.
   * Idempotent: accepting an already-promoted realization returns the current head commit.
   */
  async accept(input: AcceptInput): Promise<AcceptResult> {
    const rec = this.realization(input.realizationId);
    if (!rec) return { ok: false, code: "not-found", message: `unknown realization ${input.realizationId}` };
    if (rec.target !== "genome") return { ok: false, code: "invalid-state", message: "only genome realizations are accepted; promote app candidates" };
    const cand = this.one("SELECT * FROM candidates WHERE realization_id = ? ORDER BY rowid DESC LIMIT 1", input.realizationId);
    if (!cand) return { ok: false, code: "invalid-state", message: "realization has no submitted candidate" };
    if (rec.realization.status === "promoted") {
      const head = this.kv("head")!;
      return { ok: true, commit: this.systemCommit(head)!, realization: rec.realization, genomeCommit: this.kv("genome_commit")! };
    }
    if (TERMINAL_REALIZATION.includes(rec.realization.status)) return { ok: false, code: "invalid-state", message: `realization is ${rec.realization.status}` };
    const genomeCommit = String(cand.commit_hash);
    const prep = await this.prepareCommit(input, (prev) => ({
      genomeCommit, artifacts: { ...(prev?.artifacts ?? {}) }, templateVersions: {}, hookVersions: {},
    }));
    const evo = this.one("SELECT kind FROM evolutions WHERE id = ?", rec.evolutionId);
    let commit: SystemCommit;
    try {
      commit = this.ctx.storage.transactionSync(() => {
        if (this.kv("head") !== prep.head) throw new StaleBaseError(this.kv("head"));
        const c = this.writeCommit(prep, [rec.evolutionId], { by: input.by, policy: "admin-accept", rationale: input.rationale, candidates: [String(cand.id)] });
        this.setKv("genome_commit", genomeCommit);
        this.setKv("genome_source", rec.forkRepo);
        this.sql.exec("UPDATE candidates SET state = 'promoted' WHERE id = ?", cand.id);
        this.setRealizationStatus(input.realizationId, "promoted");
        this.seedEvolutions(input.evolutions, genomeCommit);
        this.setEvolutionStatus(rec.evolutionId, evo?.kind === "mixed" ? "genome-approved" : "promoted", true);
        return c;
      });
    } catch (e) {
      if (e instanceof StaleBaseError) return { ok: false, code: "stale-base", message: e.message };
      throw e;
    }
    const realization = this.realizationDto(this.realizationRow(input.realizationId)!);
    this.emit({ type: "genome.accepted", genomeCommit });
    this.emit({ type: "system.promoted", commit });
    this.emit({ type: "realization.updated", realization });
    const e = this.evolution(rec.evolutionId);
    if (e) this.emit({ type: "evolution.updated", evolution: e });
    return { ok: true, commit, realization, genomeCommit };
  }

  /** Newest first. */
  history(): SystemCommit[] {
    return this.all("SELECT * FROM system_commits ORDER BY rowid DESC").map((r) => this.commitDto(r));
  }

  systemCommit(id: string): SystemCommit | null {
    const r = this.one("SELECT * FROM system_commits WHERE id = ?", id);
    return r ? this.commitDto(r) : null;
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

  // ---------------------------------------------------------------- registry (instance `__registry` only)

  private registryStore: RegistryStore | undefined;

  /** The registry lives only in the `__registry` instance; System instances refuse registry calls. */
  private registry(): RegistryStore {
    if (this.ctx.id.name !== REGISTRY) throw new ConflictError("invalid-state", "registry calls go to the __registry instance");
    return (this.registryStore ??= new RegistryStore(this.sql));
  }

  registerSystem(summary: SystemSummary): void { this.registry().registerSystem(summary); }
  listSystems(): SystemSummary[] { return this.registry().listSystems(); }
  registerRealization(realizationId: string, systemId: string, evolutionId: string, forkRepo: string): void {
    this.registry().registerRealization(realizationId, systemId, evolutionId, forkRepo);
  }
  unregisterRealization(realizationId: string): void { this.registry().unregisterRealization(realizationId); }
  resolveRealization(realizationId: string) { return this.registry().resolveRealization(realizationId); }
  /** Fork repo name → owning realization (queue `resolveFork`). */
  resolveFork(forkRepo: string) { return this.registry().resolveFork(forkRepo); }
}
