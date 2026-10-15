/**
 * The public site deploys from Artifacts. A push to `main` of `artyfact/platform.builds` (written by `artyfact release`
 * and `artyfact operator publish`) reaches the `artyfact-site-deploys` queue through an Artifacts event subscription;
 * the consumer starts one `artyfact-site-deploy` Workflow per commit. The Workflow checks that exact commit out,
 * validates release.json and site/wrangler.jsonc outside the sandbox, and uploads the committed site/dist with the
 * pinned Wrangler. Nothing is rebuilt and only `artyfact-site` is deployed. Design: docs/design/release-artifacts.md.
 */
import { CF_API_BASE_URL, cleanEnv, isObj, noSymlinks, parseJsonc, PRELUDE, refuse, shQuote, WORKSPACE, WRANGLER } from "./deploy-config";
import { deployedVersionId, type DoStep } from "./pipeline";
import { authorized } from "./verification";

export const SITE = { namespace: "artyfact", repo: "platform.builds", ref: "refs/heads/main", worker: "artyfact-site", config: "site/wrangler.jsonc" } as const;
/** Env name the deploy runner receives the generated Wrangler config in (redacted from step notifications). */
export const SITE_CONFIG_ENV = "ARTYFACT_SITE_CONFIG";
const COMMIT_RE = /^[0-9a-f]{40}$/;
const VERSION_RE = /^(?:v-[0-9a-f]{12}|verified-[0-9a-f]{24})$/;
const DIST = `${WORKSPACE}/site/dist`;
const ERROR_MAX = 4000;

export interface SiteDeployParams { commit: string }

export interface SiteDeployRecord {
  commit: string;
  /** `superseded`: main had moved on before upload, so the newer commit's own run deploys instead. */
  status: "deployed" | "superseded" | "failed";
  release?: string;
  sourceCommit?: string;
  /** Worker version id Wrangler reported for the upload. */
  versionId?: string;
  startedAt: string;
  finishedAt: string;
  error?: string;
}

export const siteDeployKey = (commit: string) => `site-deploys/v1/${commit}.json`;
export const SITE_DEPLOY_LATEST = "site-deploys/v1/latest.json";
export const siteDeployInstanceId = (commit: string) => `site-${commit}`;

/** The commit a `pushed` event to platform.builds `main` names, or why the event is not a site deploy. */
export function sitePushOf(body: unknown): { commit: string } | { ignored: string } {
  let v = body;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return { ignored: "body is not JSON" }; }
  }
  if (!isObj(v) || v.type !== "cf.artifacts.repo.pushed") return { ignored: "not a pushed event" };
  const source = isObj(v.source) ? v.source : {}, payload = isObj(v.payload) ? v.payload : {};
  if (source.namespace !== SITE.namespace || source.repoName !== SITE.repo) return { ignored: `push to ${String(source.namespace)}/${String(source.repoName)}` };
  if (payload.ref !== SITE.ref) return { ignored: `push to ${String(payload.ref)}` };
  if (typeof payload.after !== "string" || !COMMIT_RE.test(payload.after) || /^0+$/.test(payload.after)) return { ignored: "push names no commit" };
  return { commit: payload.after };
}

export interface SiteQueueMessage { readonly id: string; readonly body: unknown; ack(): void; retry(): void }
export interface SiteQueueDeps {
  /** True once the commit has a recorded run. */
  recorded(commit: string): Promise<boolean>;
  /** Start the commit's Workflow; starting an existing instance id is a no-op. */
  start(commit: string): Promise<void>;
}

/** One run per commit: a redelivered or repeated event finds the record or the instance and starts nothing new. */
export async function handleSiteDeployBatch(messages: readonly SiteQueueMessage[], deps: SiteQueueDeps): Promise<void> {
  for (const m of messages) {
    const push = sitePushOf(m.body);
    if ("ignored" in push) {
      console.info(`[site-deploy] ignored ${m.id}: ${push.ignored}`);
      m.ack();
      continue;
    }
    try {
      if (!await deps.recorded(push.commit)) await deps.start(push.commit);
      m.ack();
    } catch (e) {
      console.error(`[site-deploy] ${push.commit.slice(0, 12)}: ${(e as Error)?.message ?? e}; retrying`);
      m.retry();
    }
  }
}

/** release.json must list the site at its fixed config path and name the source commit it was built from. */
export function validateRelease(text: string | null): { release: string; sourceCommit: string } {
  if (text === null) throw new Error("release.json is missing");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("release.json is not JSON"); }
  if (!isObj(raw)) throw new Error("release.json must hold an object");
  const site = isObj(raw.workers) ? raw.workers[SITE.worker] : undefined;
  if (!isObj(site) || site.config !== SITE.config) throw new Error(`release.json does not list ${SITE.worker} at ${SITE.config}`);
  if (typeof raw.version !== "string" || !VERSION_RE.test(raw.version)) throw new Error("release.json version is not a release tag");
  // `artyfact release` records gitCommit; a verified release records its approved source.
  const sourceCommit = raw.gitCommit ?? (isObj(raw.source) ? raw.source.commit : undefined);
  if (typeof sourceCommit !== "string" || !COMMIT_RE.test(sourceCommit)) throw new Error("release.json names no 40-hex source commit");
  return { release: raw.version, sourceCommit };
}

const SITE_KEYS = new Set(["$schema", "name", "compatibility_date", "compatibility_flags", "assets", "routes"]);
const ASSET_KEYS = new Set(["directory", "html_handling", "not_found_handling"]);
const ROUTE_KEYS = new Set(["pattern", "custom_domain", "zone_name", "zone_id"]);

/** The committed site config checked against an assets-only allowlist, rewritten to upload the checkout's site/dist. */
export function siteDeployConfig(text: string | null, accountId: string): Record<string, unknown> {
  if (text === null) throw new Error(`${SITE.config} is missing`);
  let raw: unknown;
  try { raw = parseJsonc(text); } catch (e) { throw new Error(`${SITE.config} is not valid JSON(C): ${(e as Error).message}`); }
  if (!isObj(raw)) throw new Error(`${SITE.config} must hold an object`);
  const problems = Object.keys(raw).filter((k) => !SITE_KEYS.has(k)).map((k) => `${k} is not allowed for the assets-only site`);
  if (raw.name !== SITE.worker) problems.push(`name must be ${SITE.worker}`);
  if (typeof raw.compatibility_date !== "string") problems.push("compatibility_date is required");
  const assets = isObj(raw.assets) ? raw.assets : null;
  if (!assets || (assets.directory !== "./dist" && assets.directory !== "dist")) problems.push("assets.directory must be ./dist");
  for (const k of Object.keys(assets ?? {})) if (!ASSET_KEYS.has(k)) problems.push(`assets.${k} is not allowed`);
  const routes = raw.routes ?? [];
  if (!Array.isArray(routes) || routes.some((r) => !isObj(r) || typeof r.pattern !== "string" || Object.keys(r).some((k) => !ROUTE_KEYS.has(k))))
    problems.push("routes must be a list of { pattern, custom_domain | zone_name | zone_id }");
  if (problems.length) throw new Error(`refusing to deploy ${SITE.config}: ${problems.join("; ")}`);
  const { $schema: _schema, ...config } = raw;
  return { ...config, account_id: accountId, assets: { ...assets, directory: DIST } };
}

/** Upload the committed site/dist; only the Cloudflare token and account cross into Wrangler's environment. */
export function siteDeployCommand(): string {
  const env = cleanEnv(`"$C"`, [
    `CLOUDFLARE_API_BASE_URL=${CF_API_BASE_URL}`, `CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN"`, `CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"`,
  ]);
  return [
    ...PRELUDE,
    `A=$(realpath -e ${shQuote(DIST)}) || ${refuse("site/dist is missing")}`,
    `[ "$A" = ${shQuote(DIST)} ] || ${refuse("site/dist resolves elsewhere")}`,
    noSymlinks(`"$A"`, "site/dist"),
    `C=$(mktemp -d /tmp/artyfact-site-XXXXXX)`,
    `cd "$C"`,
    `printf '%s' "$${SITE_CONFIG_ENV}" > wrangler.json`,
    [env, WRANGLER, "deploy", `--config "$C/wrangler.json"`, "--env-file=/dev/null", "--autoconfig=false"].join(" "),
  ].join("\n");
}

export interface SiteRunnerOptions {
  name: string;
  command: string;
  env: Record<string, string>;
  config: { retries: { limit: number; delay: number; backoff?: "constant" } };
  cloudflareCredentials: { accountId: string };
}

export interface SiteDeployInput {
  commit: string;
  accountId: string;
  step: DoStep;
  ci: { runner(options: SiteRunnerOptions): Promise<{ logs?: { stdout: string | ReadableStream<Uint8Array> } }> };
  /** Reads a file of platform.builds at `commit`, outside the sandbox (null when absent). */
  readFile(path: string): Promise<string | null>;
  /** platform.builds `main` now. */
  mainHead(): Promise<string | null>;
  record(record: SiteDeployRecord): Promise<void>;
}

/** Validate, check main still names this commit, upload, then record the outcome; a failure is recorded and rethrown. */
export async function runSiteDeploy(input: SiteDeployInput): Promise<SiteDeployRecord> {
  const { commit, step } = input;
  const now = (name: string) => step(name, async () => new Date().toISOString());
  const startedAt = await now("started");
  let outcome: Pick<SiteDeployRecord, "status" | "release" | "sourceCommit" | "versionId" | "error">;
  let failure: unknown;
  let release: { release: string; sourceCommit: string } | undefined;
  try {
    if (!COMMIT_RE.test(commit)) throw new Error("commit must be 40 lowercase hex");
    release = validateRelease(await step("read release.json", () => input.readFile("release.json")));
    const config = siteDeployConfig(await step("read site config", () => input.readFile(SITE.config)), input.accountId);
    if (await step("read main", () => input.mainHead()) !== commit) outcome = { status: "superseded", ...release };
    else {
      const runner = await input.ci.runner({
        name: "deploy site", command: siteDeployCommand(), env: { [SITE_CONFIG_ENV]: JSON.stringify(config) },
        config: { retries: { limit: 1, delay: 10_000, backoff: "constant" } }, cloudflareCredentials: { accountId: input.accountId },
      });
      const versionId = await step("deployed version", () => deployedVersionId(runner));
      outcome = { status: "deployed", ...release, ...(versionId && { versionId }) };
    }
  } catch (e) {
    failure = e;
    outcome = { status: "failed", ...release, error: String((e as Error)?.message ?? e).slice(0, ERROR_MAX) };
  }
  const record: SiteDeployRecord = { commit, ...outcome, startedAt, finishedAt: await now("finished") };
  await step("record", () => input.record(record));
  if (failure) throw failure;
  return record;
}

export interface SiteRecordBucket {
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

const RECORD_HTTP = { contentType: "application/json", cacheControl: "private, no-store" };

/** One record per commit; `latest` follows deploys and failures, never a superseded run that finished late. */
export async function recordSiteDeploy(bucket: SiteRecordBucket, record: SiteDeployRecord): Promise<void> {
  const body = JSON.stringify(record);
  await bucket.put(siteDeployKey(record.commit), body, { httpMetadata: RECORD_HTTP });
  if (record.status !== "superseded") await bucket.put(SITE_DEPLOY_LATEST, body, { httpMetadata: RECORD_HTTP });
}

/** Read-only `GET /site-deploys/latest` and `GET /site-deploys/<commit>` behind the operator bearer. */
export async function handleSiteDeployHttp(request: Request, deps: { token: string; bucket: SiteRecordBucket }): Promise<Response> {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
  if (!await authorized(request.headers.get("authorization"), deps.token)) return json({ error: "unauthorized" }, 401);
  const match = /^\/site-deploys\/(latest|[0-9a-f]{40})$/.exec(new URL(request.url).pathname);
  if (request.method !== "GET" || !match) return json({ error: "not found" }, 404);
  const object = await deps.bucket.get(match[1] === "latest" ? SITE_DEPLOY_LATEST : siteDeployKey(match[1]!));
  return object ? new Response(await object.text(), { headers: { "content-type": "application/json", "cache-control": "no-store" } }) : json({ error: "not found" }, 404);
}
