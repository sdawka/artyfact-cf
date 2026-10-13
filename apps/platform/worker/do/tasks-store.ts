/**
 * Task plans and Tasks of one System (tables `task_plans` and `tasks` in schema.ts), held by the SystemAuthority DO.
 * Spec: docs/design/backend.md B.9.
 *
 * A plan row keeps the whole {@link TaskPlan} as planned (task order included); each task row keeps the task's
 * definition in `json` and its live state in columns (`status`, `realization_id`, `claimed_*`), which win on read.
 * `criteria_json` and `nodes_json` mirror the definition for SQL. Plans are DO-only: the Genome never holds them.
 *
 * A claim is a lease: `claimTask` moves a `planned` task (or one whose lease lapsed) to `claimed` in one conditional
 * UPDATE, refused while any `dependsOn` task is not `promoted`.
 */
import type { Task, TaskPlan, TaskStatus } from "../../shared/api";
import { nowIso } from "../util";
import { ConflictError } from "./system-authority";

type Row = Record<string, SqlStorageValue>;

/** How long a claim holds before another agent may take the task over. */
export const TASK_LEASE_MS = 30 * 60_000;

/** The definition fields an admin may edit while the task is `planned`. */
export type TaskPatch = Partial<Pick<Task, "title" | "intent" | "nodes" | "footprint" | "acceptanceCriteria" | "dependsOn" | "thing">>;

export type TaskClaimResult =
  | { claimed: Task; fresh: boolean }
  | { refused: "not-found" | "taken" | "blocked" | "invalid-state"; by?: string; blockedOn?: string[] };

/** See {@link TasksStore.claimForStart}. */
export type ClaimForStart =
  | { fresh: Task; takeover: string | null }
  | { existing: Task }
  | { refused: "not-found" | "in-progress" | "taken" | "blocked" | "invalid-state"; by?: string; blockedOn?: string[] };

/** Per-Evolution plan counts (the wire `TaskPlanSummary`). */
export interface PlanCounts { tasks: number; waves: number; byStatus: Partial<Record<TaskStatus, number>>; updatedAt: string }

/** Synchronous transaction of the owning DO (`ctx.storage.transactionSync`). */
type Transact = <T>(fn: () => T) => T;

/** SQL condition on a row of `tasks`: every `dependsOn` task is promoted (an unknown dependency is unmet). */
const DEPS_MET = `NOT EXISTS (SELECT 1 FROM json_each(tasks.json, '$.dependsOn') d
  WHERE NOT EXISTS (SELECT 1 FROM tasks t2 WHERE t2.id = d.value AND t2.status = 'promoted'))`;

export class TasksStore {
  constructor(private readonly sql: SqlStorage, private readonly transact: Transact) {}

  private all(q: string, ...args: SqlStorageValue[]): Row[] {
    return this.sql.exec(q, ...args).toArray() as Row[];
  }

  private row(id: string): Row | undefined {
    return this.all("SELECT * FROM tasks WHERE id = ?", id)[0];
  }

  /** The task's definition with its live state from the columns. */
  private dto(r: Row): Task {
    const { realizationId: _r, claim: _c, ...def } = JSON.parse(String(r.json)) as Task;
    return {
      ...def,
      status: String(r.status) as TaskStatus,
      ...(r.realization_id != null && { realizationId: String(r.realization_id) }),
      ...(r.claimed_by != null && { claim: { agentLabel: String(r.claimed_by), at: String(r.claimed_at), expiresAt: String(r.claim_expires) } }),
    };
  }

  /**
   * Replaces the Evolution's plan and its task rows in one transaction. Refused (`invalid-state`) once any task of the
   * Evolution is past `planned`, when a task belongs to another Evolution or is not `planned`, or when a task id is
   * repeated or already used by another Evolution's plan.
   */
  putPlan(plan: TaskPlan): TaskPlan {
    return this.transact(() => {
      const started = this.all("SELECT id, status FROM tasks WHERE evolution_id = ? AND status != 'planned'", plan.evolutionId);
      if (started.length) {
        throw new ConflictError("invalid-state", `the plan of ${plan.evolutionId} is in progress (${started.map((r) => `${r.id} is ${r.status}`).join(", ")})`);
      }
      const ids = new Set<string>();
      for (const t of plan.tasks) {
        if (t.evolutionId !== plan.evolutionId) throw new ConflictError("invalid-state", `task ${t.id} belongs to ${t.evolutionId}, not ${plan.evolutionId}`);
        if (t.status !== "planned") throw new ConflictError("invalid-state", `task ${t.id} is ${t.status}; a new plan holds planned tasks only`);
        if (ids.has(t.id)) throw new ConflictError("invalid-state", `task ${t.id} appears twice in the plan`);
        ids.add(t.id);
        const other = this.all("SELECT evolution_id FROM tasks WHERE id = ? AND evolution_id != ?", t.id, plan.evolutionId)[0];
        if (other) throw new ConflictError("invalid-state", `task ${t.id} belongs to the plan of ${other.evolution_id}`);
      }
      const at = nowIso();
      const prev = this.all("SELECT created_at FROM task_plans WHERE evolution_id = ?", plan.evolutionId)[0];
      this.sql.exec("DELETE FROM tasks WHERE evolution_id = ?", plan.evolutionId);
      this.sql.exec(
        `INSERT INTO task_plans (evolution_id, json, genome_commit, app_commit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(evolution_id) DO UPDATE SET json = excluded.json, genome_commit = excluded.genome_commit, app_commit = excluded.app_commit, updated_at = excluded.updated_at`,
        plan.evolutionId, JSON.stringify(plan), plan.genomeCommit, plan.appCommit, prev ? String(prev.created_at) : at, at,
      );
      for (const t of plan.tasks) {
        const { realizationId: _r, claim: _c, ...def } = t;
        this.sql.exec(
          `INSERT INTO tasks (id, evolution_id, status, json, criteria_json, nodes_json, created_at, updated_at)
           VALUES (?, ?, 'planned', ?, ?, ?, ?, ?)`,
          t.id, plan.evolutionId, JSON.stringify(def), JSON.stringify(t.acceptanceCriteria), JSON.stringify(t.nodes), at, at,
        );
      }
      return this.plan(plan.evolutionId)!;
    });
  }

  /** The stored plan with each task's current row (definition edits, status, claim, realization); null when unplanned. */
  plan(evolutionId: string): TaskPlan | null {
    const r = this.all("SELECT json, updated_at FROM task_plans WHERE evolution_id = ?", evolutionId)[0];
    if (!r) return null;
    const plan = JSON.parse(String(r.json)) as TaskPlan;
    return { ...plan, tasks: this.tasks({ evolutionId }), updatedAt: String(r.updated_at) };
  }

  /** Tasks in plan order (insertion order per Evolution), optionally of one Evolution and in some statuses. */
  tasks(filter: { evolutionId?: string; status?: TaskStatus[] } = {}): Task[] {
    const status = filter.status ?? [];
    const rows = this.all(
      `SELECT * FROM tasks WHERE (?1 IS NULL OR evolution_id = ?1)
       ${status.length ? `AND status IN (${status.map((_, i) => `?${i + 2}`).join(",")})` : ""} ORDER BY evolution_id, rowid`,
      filter.evolutionId ?? null, ...status,
    );
    return rows.map((r) => this.dto(r));
  }

  task(id: string): Task | null {
    const r = this.row(id);
    return r ? this.dto(r) : null;
  }

  /** Task ids of `id`'s `dependsOn` that are not promoted (unknown ones included). */
  blockedOn(id: string): string[] {
    return this.all(
      `SELECT d.value AS dep FROM tasks, json_each(tasks.json, '$.dependsOn') d WHERE tasks.id = ?
       AND NOT EXISTS (SELECT 1 FROM tasks t2 WHERE t2.id = d.value AND t2.status = 'promoted')`, id,
    ).map((r) => String(r.dep));
  }

  /** Edits a task's definition; only while it is `planned` (`invalid-state` otherwise). */
  updateTask(id: string, patch: TaskPatch): Task {
    const r = this.row(id);
    if (!r) throw new ConflictError("not-found", `unknown task ${id}`);
    const next = { ...(JSON.parse(String(r.json)) as Task), ...patch };
    const at = nowIso();
    const [won] = this.all(
      "UPDATE tasks SET json = ?, criteria_json = ?, nodes_json = ?, updated_at = ? WHERE id = ? AND status = 'planned' RETURNING *",
      JSON.stringify(next), JSON.stringify(next.acceptanceCriteria), JSON.stringify(next.nodes), at, id,
    );
    if (!won) throw new ConflictError("invalid-state", `task ${id} is ${r.status}; only a planned task can be edited`);
    this.sql.exec("UPDATE task_plans SET updated_at = ? WHERE evolution_id = ?", at, String(r.evolution_id));
    return this.dto(won);
  }

  /**
   * Claims `id` for `agentLabel` until `now + leaseMs`. One conditional UPDATE decides a fresh claim: the task is
   * `planned`, or `claimed` with a lapsed lease, and every `dependsOn` task is promoted. A fresh claim clears any
   * realization of a lapsed claim. Refused: say why; the same label on its own live claim gets it back, `fresh: false`.
   */
  claimTask(id: string, agentLabel: string, now: number = Date.now(), leaseMs: number = TASK_LEASE_MS): TaskClaimResult {
    const at = new Date(now).toISOString();
    const [won] = this.all(
      `UPDATE tasks SET status = 'claimed', claimed_by = ?, claimed_at = ?, claim_expires = ?, realization_id = NULL, updated_at = ?
       WHERE id = ? AND (status = 'planned' OR (status = 'claimed' AND claim_expires < ?)) AND ${DEPS_MET} RETURNING *`,
      agentLabel, at, new Date(now + leaseMs).toISOString(), at, id, at,
    );
    if (won) return { claimed: this.dto(won), fresh: true };
    const r = this.row(id);
    if (!r) return { refused: "not-found" };
    const live = String(r.status) === "claimed" && String(r.claim_expires) >= at;
    if (live && String(r.claimed_by) === agentLabel) return { claimed: this.dto(r), fresh: false };
    if (live) return { refused: "taken", by: String(r.claimed_by) };
    if (["planned", "claimed"].includes(String(r.status))) return { refused: "blocked", blockedOn: this.blockedOn(id) };
    return { refused: "invalid-state" };
  }

  /**
   * The claim decision of a start (`SystemAuthority.claimAndReserve`), to run inside the caller's transaction:
   * - `fresh`: the task is now claimed by `agentLabel` with no realization; `takeover` names the live realization of a
   *   lapsed claim that the caller must abandon.
   * - `existing`: `agentLabel` already holds the task with an activated realization (its lease renewed if it lapsed).
   * - `refused`: `in-progress` while a claim's realization is reserved but not yet activated (any label, until its
   *   lease lapses), `taken`, `blocked`, `invalid-state`, `not-found`.
   */
  claimForStart(id: string, agentLabel: string, now: number = Date.now(), leaseMs: number = TASK_LEASE_MS): ClaimForStart {
    const at = new Date(now).toISOString();
    const expires = new Date(now + leaseMs).toISOString();
    const r = this.row(id);
    if (!r) return { refused: "not-found" };
    const status = String(r.status);
    const rid = r.realization_id == null ? null : String(r.realization_id);
    const real = rid ? this.all("SELECT status, packet_json FROM realizations WHERE id = ?", rid)[0] : undefined;
    const liveReal = !!real && !["promoted", "rejected", "abandoned"].includes(String(real.status));
    const activated = liveReal && real!.packet_json != null;
    const mine = String(r.claimed_by ?? "") === agentLabel;
    if (status === "planned") {
      const [won] = this.all(
        `UPDATE tasks SET status = 'claimed', claimed_by = ?, claimed_at = ?, claim_expires = ?, realization_id = NULL, updated_at = ?
         WHERE id = ? AND status = 'planned' AND ${DEPS_MET} RETURNING *`, agentLabel, at, expires, at, id,
      );
      return won ? { fresh: this.dto(won), takeover: null } : { refused: "blocked", blockedOn: this.blockedOn(id) };
    }
    if (status === "claimed") {
      const live = String(r.claim_expires) >= at;
      if (live) {
        if (!activated) return { refused: "in-progress", by: String(r.claimed_by) };
        return mine ? { existing: this.dto(r) } : { refused: "taken", by: String(r.claimed_by) };
      }
      if (mine && activated) {
        const [renewed] = this.all("UPDATE tasks SET claim_expires = ?, updated_at = ? WHERE id = ? RETURNING *", expires, at, id);
        return { existing: this.dto(renewed) };
      }
      const [won] = this.all(
        `UPDATE tasks SET claimed_by = ?, claimed_at = ?, claim_expires = ?, realization_id = NULL, updated_at = ? WHERE id = ? AND status = 'claimed' RETURNING *`,
        agentLabel, at, expires, at, id,
      );
      return { fresh: this.dto(won), takeover: liveReal ? rid : null };
    }
    if (["realizing", "evaluated"].includes(status) && mine && activated) return { existing: this.dto(r) };
    return { refused: "invalid-state" };
  }

  /** Renews the lease of the task bound to `realizationId` while it is live (checkpoint and submit call this). */
  renewLease(realizationId: string, now: number = Date.now(), leaseMs: number = TASK_LEASE_MS): void {
    this.sql.exec(
      `UPDATE tasks SET claim_expires = ?, updated_at = ? WHERE realization_id = ? AND claimed_by IS NOT NULL AND status IN ('claimed', 'realizing', 'evaluated')`,
      new Date(now + leaseMs).toISOString(), new Date(now).toISOString(), realizationId,
    );
  }

  /** Records the realization a claim started; the task stays `claimed` (`invalid-state` unless it is). */
  bindTask(id: string, realizationId: string): Task {
    const [won] = this.all("UPDATE tasks SET realization_id = ?, updated_at = ? WHERE id = ? AND status = 'claimed' RETURNING *", realizationId, nowIso(), id);
    if (won) return this.dto(won);
    const r = this.row(id);
    if (!r) throw new ConflictError("not-found", `unknown task ${id}`);
    throw new ConflictError("invalid-state", `task ${id} is ${r.status}; only a claimed task is bound to a realization`);
  }

  /**
   * Back to `planned` with no claim and no realization (the realization keeps its own status). A promoted task is
   * never released (`invalid-state`); a planned one is returned unchanged.
   */
  releaseTask(id: string): Task {
    const [won] = this.all(
      `UPDATE tasks SET status = 'planned', claimed_by = NULL, claimed_at = NULL, claim_expires = NULL, realization_id = NULL, updated_at = ?
       WHERE id = ? AND status NOT IN ('planned', 'promoted') RETURNING *`, nowIso(), id,
    );
    if (won) return this.dto(won);
    const r = this.row(id);
    if (!r) throw new ConflictError("not-found", `unknown task ${id}`);
    if (String(r.status) === "promoted") throw new ConflictError("invalid-state", `task ${id} is promoted`);
    return this.dto(r);
  }

  setTaskStatus(id: string, status: TaskStatus): void {
    this.sql.exec("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?", status, nowIso(), id);
  }

  /** Moves the task bound to `realizationId` from one of `from` to `to`; returns the ids moved (none or one). */
  advance(realizationId: string, to: TaskStatus, from: TaskStatus[]): string[] {
    return this.all(
      `UPDATE tasks SET status = ?, updated_at = ? WHERE realization_id = ? AND status IN (${from.map(() => "?").join(",")}) RETURNING id`,
      to, nowIso(), realizationId, ...from,
    ).map((r) => String(r.id));
  }

  /** Releases the task bound to `realizationId` unless it is promoted (see {@link releaseTask}); returns the ids released. */
  releaseFor(realizationId: string): string[] {
    return this.all(
      `UPDATE tasks SET status = 'planned', claimed_by = NULL, claimed_at = NULL, claim_expires = NULL, realization_id = NULL, updated_at = ?
       WHERE realization_id = ? AND status NOT IN ('planned', 'promoted') RETURNING id`, nowIso(), realizationId,
    ).map((r) => String(r.id));
  }

  /** Points a task at a realization (promotion binds the winning one). */
  setTaskRealization(id: string, realizationId: string): void {
    this.sql.exec("UPDATE tasks SET realization_id = ?, updated_at = ? WHERE id = ?", realizationId, nowIso(), id);
  }

  /** The task's acceptance criteria (`criteria_json`); null for an unknown task. */
  criteria(id: string): string[] | null {
    const r = this.all("SELECT criteria_json FROM tasks WHERE id = ?", id)[0];
    return r ? (JSON.parse(String(r.criteria_json ?? "[]")) as string[]) : null;
  }

  /** The Evolution's plan counts; null when it has no plan. */
  planCounts(evolutionId: string): PlanCounts | null {
    const p = this.all("SELECT json_array_length(json, '$.waves') AS waves, updated_at FROM task_plans WHERE evolution_id = ?", evolutionId)[0];
    if (!p) return null;
    const out: PlanCounts = { tasks: 0, waves: Number(p.waves ?? 0), byStatus: {}, updatedAt: String(p.updated_at) };
    for (const r of this.all("SELECT status, COUNT(*) AS n FROM tasks WHERE evolution_id = ? GROUP BY status", evolutionId)) {
      out.byStatus[String(r.status) as TaskStatus] = Number(r.n);
      out.tasks += Number(r.n);
    }
    return out;
  }

  /** Whether every task of the Evolution's plan is promoted (true when it has no tasks). */
  allPromoted(evolutionId: string): boolean {
    return !this.all("SELECT 1 FROM tasks WHERE evolution_id = ? AND status != 'promoted' LIMIT 1", evolutionId).length;
  }

  /** The System's task counts for `summary()`; null when no task exists. */
  counts(): { planReady: number; awaitingAgent: number; running: number; blocked: number; realizing: number } | null {
    const n = (q: string) => Number(this.all(q)[0]?.n ?? 0);
    if (!n("SELECT COUNT(*) AS n FROM tasks")) return null;
    return {
      planReady: n(`SELECT COUNT(*) AS n FROM task_plans p WHERE EXISTS (SELECT 1 FROM tasks t WHERE t.evolution_id = p.evolution_id)
        AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.evolution_id = p.evolution_id AND t.status != 'planned')`),
      awaitingAgent: n("SELECT COUNT(*) AS n FROM tasks WHERE status = 'claimed'"),
      running: n("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('realizing', 'evaluated')"),
      blocked: n(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'planned' AND NOT (${DEPS_MET})`),
      realizing: n("SELECT COUNT(*) AS n FROM tasks WHERE status = 'realizing'"),
    };
  }
}
