/**
 * Per-fork Artifacts event subscriptions (REST control plane). Repo-level `pushed` subscriptions need `namespace` +
 * `repo_name`, so each realization fork gets its own, delivering to the `artyfact-artifacts-events` queue: the queue
 * consumer is the safety net that submits pushes nobody submitted. CI never depends on them (the platform dispatches
 * builds itself). Both calls are no-ops without `CF_API_TOKEN`, `EVENTS_QUEUE_ID` and `ACCOUNT_ID`, and never throw.
 */

const API = "https://api.cloudflare.com/client/v4";

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

interface Config { token: string; queueId: string; accountId: string; namespace: string }

let override: { fetch?: FetchFn; config?: Partial<Config> } | undefined;
let fetchOverride: FetchFn | undefined;
/** Tests inject the Cloudflare API and the config the Worker env would supply. */
export function setSubscriptionsOverride(o: { fetch?: FetchFn; config?: Partial<Config> } | undefined): void {
  override = o;
  fetchOverride = o?.fetch;
}

function config(env: Env): Config | null {
  const token = override?.config?.token ?? env.CF_API_TOKEN?.trim();
  const queueId = override?.config?.queueId ?? env.EVENTS_QUEUE_ID?.trim();
  const accountId = override?.config?.accountId ?? env.ACCOUNT_ID?.trim();
  if (!token || !queueId || !accountId) return null;
  return { token, queueId, accountId, namespace: env.ARTIFACTS_NAMESPACE };
}

/** The create request body (exported for tests). */
export function subscriptionBody(namespace: string, forkRepo: string, queueId: string) {
  return {
    name: `artyfact-${forkRepo}`.slice(0, 100),
    enabled: true,
    source: { type: "artifacts.repo", namespace, repo_name: forkRepo },
    events: ["pushed"],
    destination: { type: "queues.queue", queue_id: queueId },
  };
}

/** Create the fork's `pushed` subscription; returns its id, or null when unconfigured or the API refused. */
export async function ensurePushSubscription(env: Env, forkRepo: string): Promise<string | null> {
  const cfg = config(env);
  if (!cfg) return null;
  try {
    const res = await (fetchOverride ?? fetch)(`${API}/accounts/${cfg.accountId}/event_subscriptions/subscriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify(subscriptionBody(cfg.namespace, forkRepo, cfg.queueId)),
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { id?: string }; errors?: { message?: string }[] };
    if (!res.ok || !json.result?.id) {
      console.error(`[subscriptions] creating the push subscription for ${forkRepo} failed: ${res.status} ${json.errors?.map((e) => e.message).join("; ") ?? ""}`);
      return null;
    }
    return json.result.id;
  } catch (e) {
    console.error(`[subscriptions] creating the push subscription for ${forkRepo} failed: ${(e as Error)?.message ?? e}`);
    return null;
  }
}

/** Delete a subscription; true when it is gone (deleted or already missing). */
export async function removePushSubscription(env: Env, subscriptionId: string): Promise<boolean> {
  const cfg = config(env);
  if (!cfg) return false;
  try {
    const res = await (fetchOverride ?? fetch)(`${API}/accounts/${cfg.accountId}/event_subscriptions/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${cfg.token}` },
    });
    if (res.ok || res.status === 404) return true;
    console.error(`[subscriptions] deleting subscription ${subscriptionId} failed: ${res.status}`);
    return false;
  } catch (e) {
    console.error(`[subscriptions] deleting subscription ${subscriptionId} failed: ${(e as Error)?.message ?? e}`);
    return false;
  }
}
