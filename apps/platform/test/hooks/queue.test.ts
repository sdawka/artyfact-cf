import { describe, expect, it, vi } from "vitest";
import type { QueueContext } from "../../worker/hooks/contract";
import { createQueueHandler, handleBatch, type QueueMessageLike } from "../../worker/hooks/queue";

const AFTER = "def789aa012def789aa012def789aa012def7aaa";
const pushed = (repoName = "kit-app--r1", after = AFTER) => ({
  type: "cf.artifacts.repo.pushed",
  source: { type: "artifacts.repo", namespace: "artyfact", repoName },
  payload: { ref: "refs/heads/main", before: "abc", after, commits: [], totalCommitsCount: 1, commitsTruncated: false },
  metadata: { accountId: "x", eventSubscriptionId: "s", eventSchemaVersion: 1, eventTimestamp: "2026-10-12T00:00:00Z" },
});

function msg(body: unknown, attempts = 1, id = crypto.randomUUID()) {
  const m = { id, body, attempts, timestamp: new Date(), ack: vi.fn(), retry: vi.fn() };
  return m as QueueMessageLike & { ack: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
}

function fakeCtx(forks: Record<string, string> = { "kit-app--r1": "realization.1.r1" }) {
  const seen = new Set<string>();
  const submit = vi.fn(async () => ({ ok: true }));
  const ctx: QueueContext = {
    resolveFork: vi.fn(async (_ns: string, repo: string) => forks[repo] ?? null),
    submit,
    markEventSeen: vi.fn(async (id: string) => (seen.has(id) ? false : (seen.add(id), true))),
  };
  return { ctx, submit };
}

describe("queue consumer", () => {
  it("submits a pushed event once and acks it", async () => {
    const { ctx, submit } = fakeCtx();
    const m = msg(pushed());
    const res = await handleBatch([m], ctx);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("realization.1.r1", AFTER, "event");
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(res[0].action).toBe("submitted");
  });

  it("dedupes the same event delivered twice (different message ids)", async () => {
    const { ctx, submit } = fakeCtx();
    const a = msg(pushed()), b = msg(pushed());
    await handleBatch([a], ctx);
    const res = await handleBatch([b], ctx);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(b.ack).toHaveBeenCalled();
    expect(res[0].action).toBe("duplicate");
  });

  it("acks unknown repos without submitting", async () => {
    const { ctx, submit } = fakeCtx();
    const m = msg(pushed("someone-else"));
    const res = await handleBatch([m], ctx);
    expect(submit).not.toHaveBeenCalled();
    expect(m.ack).toHaveBeenCalled();
    expect(res[0].action).toBe("unknown-repo");
  });

  it("acks other event types and malformed bodies without submitting", async () => {
    const { ctx, submit } = fakeCtx();
    const cloned = msg({ ...pushed(), type: "cf.artifacts.repo.cloned" });
    const junk = msg("not json {");
    const noAfter = msg({ ...pushed(), payload: {} });
    const res = await handleBatch([cloned, junk, noAfter], ctx);
    expect(submit).not.toHaveBeenCalled();
    expect(res.map((r) => r.action)).toEqual(["ignored", "malformed", "malformed"]);
    for (const m of [cloned, junk, noAfter]) expect(m.ack).toHaveBeenCalled();
  });

  it("accepts a JSON string body", async () => {
    const { ctx, submit } = fakeCtx();
    await handleBatch([msg(JSON.stringify(pushed()))], ctx);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("ignores branch deletions", async () => {
    const { ctx, submit } = fakeCtx();
    const res = await handleBatch([msg(pushed("kit-app--r1", "0".repeat(40)))], ctx);
    expect(submit).not.toHaveBeenCalled();
    expect(res[0].action).toBe("ignored");
  });

  it("retries when submit fails, and the retry is not swallowed by dedupe", async () => {
    const { ctx, submit } = fakeCtx();
    submit.mockRejectedValueOnce(new Error("DO unavailable"));
    const first = msg(pushed(), 1, "m1");
    const r1 = await handleBatch([first], ctx);
    expect(first.retry).toHaveBeenCalled();
    expect(first.ack).not.toHaveBeenCalled();
    expect(r1[0]).toMatchObject({ action: "retry", error: expect.stringContaining("DO unavailable") });

    const again = msg(pushed(), 2, "m1");
    const r2 = await handleBatch([again], ctx);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(r2[0].action).toBe("submitted");
  });

  it("createQueueHandler wires env to the context", async () => {
    const { ctx, submit } = fakeCtx();
    const handler = createQueueHandler(() => ctx);
    await handler({ queue: "q", messages: [msg(pushed())] } as never, {} as never);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
