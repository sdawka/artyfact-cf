// The provisioning runner of a reserved Task attempt: step order, and compensation that never masks the original error.
import { describe, expect, it } from 'vitest';
import { provisionTaskAttempt, type MintedCredentials, type ProvisioningCompensation, type ProvisioningStep, type ProvisioningSteps } from '../worker/lifecycle-provisioning';
import type { RealizationPlan } from '../shared/lifecycle';

const ORDER: ProvisioningStep[] = ['revoke-prior-credentials', 'ensure-fork', 'seed-pinned-model', 'mint-credentials', 'activate', 'assemble-packet'];
const credentials: MintedCredentials = { token: { id: 'tok-1', plaintext: 'never-logged', expiresAt: '2030-01-01T00:00:00.000Z' }, secret: 'secret' };
const plan = { id: 'plan.1' } as RealizationPlan;

/** Steps that record their order and fail at `failAt`; compensations that record their order and fail when listed in `failing`. */
function harness(o: { failAt?: ProvisioningStep; failing?: ('revoke-token' | 'end-attempt')[] } = {}) {
  const calls: string[] = [], revoked: string[] = [];
  const fail = (step: ProvisioningStep) => { calls.push(step); if (o.failAt === step) throw new Error(`${step} failed`); };
  const steps: ProvisioningSteps<string> = {
    async revokePriorCredentials() { fail('revoke-prior-credentials'); },
    async ensureFork() { fail('ensure-fork'); return { remote: 'https://fork' }; },
    async seedPinnedModel({ remote }) { fail('seed-pinned-model'); expect(remote).toBe('https://fork'); return { prefix: 'system', genomeCommit: 'g', commit: 'c' }; },
    async mintCredentials() { fail('mint-credentials'); return credentials; },
    async activate(i) { fail('activate'); expect(i).toEqual({ credentials, remote: 'https://fork', model: { prefix: 'system', genomeCommit: 'g', commit: 'c' } }); return plan; },
    async assemblePacket(i) { fail('assemble-packet'); expect(i).toEqual({ plan, credentials, remote: 'https://fork' }); return 'packet'; },
  };
  const compensation: ProvisioningCompensation = {
    async revokeToken(id) { calls.push('revoke-token'); revoked.push(id); if (o.failing?.includes('revoke-token')) throw new Error('revoke failed'); },
    async endAttempt() { calls.push('end-attempt'); if (o.failing?.includes('end-attempt')) throw new Error('end failed'); },
  };
  return { steps, compensation, calls, revoked };
}

describe('provisionTaskAttempt', () => {
  it('runs the steps in order and compensates nothing after a success', async () => {
    const h = harness();
    expect(await provisionTaskAttempt(h.steps, h.compensation)).toEqual({ ok: true, value: 'packet' });
    expect(h.calls).toEqual(ORDER);
  });
  for (const step of ORDER) {
    const minted = ORDER.indexOf(step) > ORDER.indexOf('mint-credentials');
    it(`a failure at ${step} ${minted ? 'revokes the minted token, then' : 'mints no token and'} ends the attempt, and surfaces the original error`, async () => {
      const h = harness({ failAt: step });
      const out = await provisionTaskAttempt(h.steps, h.compensation);
      if (out.ok) throw new Error('expected a failure');
      expect(out.step).toBe(step);
      expect((out.error as Error).message).toBe(`${step} failed`);
      // Reverse order: the token minted last is revoked first; the reservation made first is ended last.
      expect(out.compensation).toEqual(minted ? [{ action: 'revoke-token' }, { action: 'end-attempt' }] : [{ action: 'end-attempt' }]);
      expect(h.revoked).toEqual(minted ? ['tok-1'] : []);
      expect(h.calls).toEqual([...ORDER.slice(0, ORDER.indexOf(step) + 1), ...(minted ? ['revoke-token'] : []), 'end-attempt']);
    });
  }
  it('reports a failed revocation beside the original error and still ends the attempt', async () => {
    const h = harness({ failAt: 'activate', failing: ['revoke-token'] });
    const out = await provisionTaskAttempt(h.steps, h.compensation);
    if (out.ok) throw new Error('expected a failure');
    expect((out.error as Error).message).toBe('activate failed');
    expect(out.compensation.map((c) => [c.action, (c.error as Error | undefined)?.message])).toEqual([['revoke-token', 'revoke failed'], ['end-attempt', undefined]]);
    expect(h.calls.slice(-2)).toEqual(['revoke-token', 'end-attempt']);
  });
  it('reports a failed attempt end beside the original error', async () => {
    const h = harness({ failAt: 'ensure-fork', failing: ['end-attempt'] });
    const out = await provisionTaskAttempt(h.steps, h.compensation);
    if (out.ok) throw new Error('expected a failure');
    expect((out.error as Error).message).toBe('ensure-fork failed');
    expect(out.compensation.map((c) => [c.action, (c.error as Error | undefined)?.message])).toEqual([['end-attempt', 'end failed']]);
  });
  it('reports every compensation failure when all of them fail', async () => {
    const h = harness({ failAt: 'assemble-packet', failing: ['revoke-token', 'end-attempt'] });
    const out = await provisionTaskAttempt(h.steps, h.compensation);
    if (out.ok) throw new Error('expected a failure');
    expect((out.error as Error).message).toBe('assemble-packet failed');
    expect(out.compensation.map((c) => [c.action, (c.error as Error | undefined)?.message])).toEqual([['revoke-token', 'revoke failed'], ['end-attempt', 'end failed']]);
  });
  it('keeps a non-Error rejection as the original error', async () => {
    const h = harness();
    h.steps.mintCredentials = async () => { throw 'minting refused'; };
    const out = await provisionTaskAttempt(h.steps, h.compensation);
    expect(out).toEqual({ ok: false, step: 'mint-credentials', error: 'minting refused', compensation: [{ action: 'end-attempt' }] });
  });
});
