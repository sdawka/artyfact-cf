/**
 * Provisioning of a reserved Task attempt, and its compensation.
 *
 * `startLifecycleTask` (lifecycle-service.ts) checks Genome compatibility, prepares a fan-in base, reserves the attempt in the
 * DO (`claimLifecycleTask`) and refreshes the registry; everything between the reservation and the response happens here, in
 * this order:
 *
 *   1. revoke-prior-credentials: every earlier writer token of the task is revoked, and cleared from its realization row, before
 *      a replacement exists. A revocation failure stops here: no second writer is ever minted, and the token stays pending for
 *      the next claim or resume.
 *   2. ensure-fork: a first claim forks the task's base; a resume reuses the fork, or recreates it when the first claim failed
 *      before the fork existed (fork recovery).
 *   3. seed-pinned-model: a fork with no recorded model gets the pinned Genome under `system/` (docs/design/task-fork-model.md
 *      §1); a fork that already carries one (a resume, or a fork of a predecessor's candidate) keeps it.
 *   4. mint-credentials: the fork write token, bounded by the lease, and the realization secret.
 *   5. activate: the DO records them against the attempt, fenced on attempt id and generation and on the lease.
 *   6. assemble-packet: the agent's start response.
 *
 * A failure at any step compensates in reverse order: a minted token is revoked and cleared from the attempt's row, then the
 * reserved attempt is ended. Every compensation failure is reported in the outcome beside the original error, never instead of
 * it, and the original error is what the caller throws. The DO's `end` ignores an attempt that is no longer the task's latest, so
 * compensating a stale attempt never undoes a live one, and nothing here runs after a success.
 */
import type { RealizationPlan, TaskModel, TaskStartResponse } from '../shared/lifecycle';
import type { ClaimReservation } from './do/lifecycle-store';
import type { SystemApi } from './service';
import { artifactsErrorCode, artifactsFor, forkAndWait, remoteUrl, withRepo } from './artifacts/client';
import { newRealizationSecret } from './auth';
import { rpc } from './errors';
import { genomeAt } from './service';
import { lifecyclePacket } from './packets/lifecycle-packet';
import { seedModel, taskModelOf } from './lifecycle-model';
import { sha256Hex } from './util';

export type ProvisioningStep = 'revoke-prior-credentials' | 'ensure-fork' | 'seed-pinned-model' | 'mint-credentials' | 'activate' | 'assemble-packet';
export type CompensationAction = 'revoke-token' | 'end-attempt';

/** The writer credentials of one attempt: the fork write token and the realization secret (handed out once, only its hash is stored). */
export interface MintedCredentials { token: { id: string; plaintext: string; expiresAt: string }; secret: string }

/** The provisioning steps, in the order `provisionTaskAttempt` runs them. */
export interface ProvisioningSteps<T> {
  revokePriorCredentials(): Promise<void>;
  ensureFork(): Promise<{ remote: string }>;
  seedPinnedModel(fork: { remote: string }): Promise<TaskModel | undefined>;
  mintCredentials(): Promise<MintedCredentials>;
  activate(input: { credentials: MintedCredentials; remote: string; model: TaskModel | undefined }): Promise<RealizationPlan>;
  assemblePacket(input: { plan: RealizationPlan; credentials: MintedCredentials; remote: string }): Promise<T>;
}

/** What a failed provisioning undoes. `endAttempt` always applies (the reservation precedes provisioning); `revokeToken` once a token exists. */
export interface ProvisioningCompensation {
  revokeToken(tokenId: string): Promise<void>;
  endAttempt(): Promise<void>;
}

export interface CompensationReport { action: CompensationAction; error?: unknown }
export type ProvisioningOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; step: ProvisioningStep; error: unknown; compensation: CompensationReport[] };

/**
 * Run the steps in order; on the first failure run the applicable compensations in reverse order and report the failing step,
 * its error and every compensation result. Never throws for a step or compensation failure.
 */
export async function provisionTaskAttempt<T>(steps: ProvisioningSteps<T>, compensation: ProvisioningCompensation): Promise<ProvisioningOutcome<T>> {
  const undo: { action: CompensationAction; run: () => Promise<void> }[] = [{ action: 'end-attempt', run: () => compensation.endAttempt() }];
  let step: ProvisioningStep = 'revoke-prior-credentials';
  try {
    await steps.revokePriorCredentials();
    step = 'ensure-fork';
    const fork = await steps.ensureFork();
    step = 'seed-pinned-model';
    const model = await steps.seedPinnedModel(fork);
    step = 'mint-credentials';
    const credentials = await steps.mintCredentials();
    undo.push({ action: 'revoke-token', run: () => compensation.revokeToken(credentials.token.id) });
    step = 'activate';
    const plan = await steps.activate({ credentials, remote: fork.remote, model });
    step = 'assemble-packet';
    const value = await steps.assemblePacket({ plan, credentials, remote: fork.remote });
    return { ok: true, value };
  } catch (error) {
    const report: CompensationReport[] = [];
    for (const u of undo.reverse()) {
      try { await u.run(); report.push({ action: u.action }); } catch (e) { report.push({ action: u.action, error: e }); }
    }
    return { ok: false, step, error, compensation: report };
  }
}

export interface TaskAttemptContext {
  sid: string; pid: string; tid: string;
  /** The pinned plan as read before the reservation (its Genome ref and base manifest). */
  plan: RealizationPlan;
  claim: ClaimReservation;
  leaseSeconds?: number;
  platformUrl: string;
}

export const MAX_TOKEN_TTL_S = 3600, DEFAULT_TOKEN_TTL_S = 900;

/** The real steps and compensations of a reserved attempt against Artifacts and the System DO. */
export function taskAttemptProvisioning(env: Env, stub: SystemApi, c: TaskAttemptContext): { steps: ProvisioningSteps<TaskStartResponse>; compensation: ProvisioningCompensation } {
  const { sid, pid, tid, plan: p, claim } = c, { task, attempt } = claim, ns = artifactsFor(env);
  const steps: ProvisioningSteps<TaskStartResponse> = {
    async revokePriorCredentials() {
      // Revoke before creating replacement credentials; if revocation fails, no replacement writer is minted.
      for (const credential of await stub.lifecycleCredentials(pid, tid)) {
        if (!credential.tokenId) continue;
        await withRepo(ns, credential.forkRepo, (r) => r.revokeToken(credential.tokenId!));
        await stub.lifecycleCredentialRevoked(credential.realizationId, credential.tokenId);
      }
    },
    async ensureFork() {
      const forked = claim.createFork
        ? await forkAndWait(ns, task.base.repo, task.forkRepo, { baseCommit: task.base.commit })
        : await withRepo(ns, task.forkRepo, (r) => r.info()).catch((e) => {
          if (artifactsErrorCode(e) === 'NOT_FOUND') return forkAndWait(ns, task.base.repo, task.forkRepo, { baseCommit: task.base.commit });
          throw e;
        });
      return { remote: remoteUrl(env, task.forkRepo, forked.remote) };
    },
    async seedPinnedModel({ remote }) {
      // The fork carries the pinned model under system/ (docs/design/task-fork-model.md §1). A fork of the app binding gets the
      // pinned Genome (replacing a stale system/); a fork of a predecessor's candidate keeps the model it selected.
      if (task.model) return task.model;
      const [head] = await withRepo(ns, task.forkRepo, (r) => r.log({ limit: 1 }));
      const overwrite = task.base.repo === p.baseManifest.artifacts[task.artifactId]?.repo;
      return taskModelOf(p.genome.commit, await seedModel(ns, task.forkRepo, head?.hash ?? task.base.commit, p.genome, { overwrite, remote }));
    },
    async mintCredentials() {
      const token = await withRepo(ns, task.forkRepo, (r) => r.createToken('write', Math.min(c.leaseSeconds ?? DEFAULT_TOKEN_TTL_S, MAX_TOKEN_TTL_S)));
      return { token: { id: token.id, plaintext: token.plaintext, expiresAt: token.expiresAt }, secret: newRealizationSecret() };
    },
    async activate({ credentials, remote, model }) {
      return rpc(stub.lifecycleActivate(pid, tid, attempt.id, attempt.generation, { tokenId: credentials.token.id, tokenExpires: credentials.token.expiresAt, remote, secretHash: await sha256Hex(credentials.secret), model }));
    },
    async assemblePacket({ plan, credentials, remote }) {
      const reviewUrl = `${c.platformUrl.replace(/\/$/, '')}/s/${encodeURIComponent(sid)}/r/head/review?plan=${encodeURIComponent(pid)}&task=${encodeURIComponent(tid)}`;
      const current = plan.tasks.find((t) => t.id === tid);
      if (!current) throw new Error(`activated plan ${pid} has no task ${tid}`);
      const g = await genomeAt(env, sid, p.genome.commit, p.genome.repo);
      const packet = lifecyclePacket({ plan, task: current, attempt: current.attempts.at(-1)!, remote, reviewUrl, model: g.model });
      return { plan, task: current, attempt: current.attempts.at(-1)!, secret: credentials.secret, token: { value: credentials.token.plaintext, expiresAt: credentials.token.expiresAt, remote }, remote, packet, reviewUrl };
    },
  };
  const compensation: ProvisioningCompensation = {
    // The row is cleared only once Artifacts confirmed the revocation; a failed revocation stays pending for the next attempt.
    async revokeToken(tokenId) { await withRepo(ns, task.forkRepo, (r) => r.revokeToken(tokenId)); await stub.lifecycleCredentialRevoked(attempt.realizationId, tokenId); },
    // Fenced on attempt id and generation: a later attempt on the task is left alone.
    async endAttempt() { await stub.lifecycleEnd(pid, tid, attempt.id, attempt.generation); },
  };
  return { steps, compensation };
}
