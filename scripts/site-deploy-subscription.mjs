#!/usr/bin/env node
// Idempotently subscribes the `artyfact-site-deploys` queue to pushes on the Artifacts repo artyfact/platform.builds,
// so artyfact-ci deploys the public site from each release commit (docs/deploy.md "Resources").
//   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/site-deploy-subscription.mjs [--dry-run]
// The token needs Queues read and Event Subscriptions edit. It is only ever sent to api.cloudflare.com.
const API = "https://api.cloudflare.com/client/v4";
const QUEUE = "artyfact-site-deploys";
const NAME = "artyfact-platform.builds-site-deploy";
const dryRun = process.argv.includes("--dry-run");
const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !/^[0-9a-f]{32}$/.test(account ?? "")) {
  console.error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (32 hex)");
  process.exit(2);
}

async function api(method, path, body) {
  const res = await fetch(`${API}/accounts/${account}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, ...(body && { "content-type": "application/json" }) }, body: body && JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`${method} ${path} -> ${res.status} ${(json.errors ?? []).map((e) => e.message).join("; ")}`);
  return json.result;
}

const queues = await api("GET", `/queues?per_page=100`);
const queue = (queues ?? []).find((q) => q.queue_name === QUEUE);
if (!queue) throw new Error(`queue ${QUEUE} does not exist; run: npx wrangler queues create ${QUEUE}`);
const body = {
  name: NAME,
  enabled: true,
  source: { type: "artifacts.repo", namespace: "artyfact", repo_name: "platform.builds" },
  events: ["pushed"],
  destination: { type: "queues.queue", queue_id: queue.queue_id },
};
const existing = ((await api("GET", "/event_subscriptions/subscriptions?per_page=100")) ?? []).find((s) => s.name === NAME);
if (existing) {
  const same = existing.destination?.queue_id === queue.queue_id && existing.source?.repo_name === "platform.builds" && existing.enabled !== false;
  console.log(`${NAME} exists (${existing.id})${same ? "" : "; its source, destination or state differs: delete it in the dashboard and rerun"}`);
  process.exit(same ? 0 : 1);
}
if (dryRun) {
  console.log(`would create: ${JSON.stringify(body)}`);
} else {
  const created = await api("POST", "/event_subscriptions/subscriptions", body);
  console.log(`created ${NAME} (${created?.id})`);
}
