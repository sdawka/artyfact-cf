/**
 * artyfact-ci: builds and deploys app commits for the artyfact platform. The platform starts the `artyfact-ci`
 * Workflow itself (cross-script Workflows binding) with {@link CiBuildParams}; no push trigger is configured.
 */
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { CIWorkflow, type CiContext, type CiParams, type CloudflareArtifacts, type CiWorkflowPayload } from "@cloudflare/ci";
import { CiSandbox, type CiBindings } from "@cloudflare/ci/worker";
import type { CiBuildParams } from "./contract";
import type { VerificationRequest } from "@artyfact/model";
import { parseD1DatabaseIds, parseFlagshipAppIds } from "./deploy-config";
import { runPipeline, type CiLike, type DoStep, type FetchLike } from "./pipeline";
import { readVerificationGenome } from "./verification-artifacts";
import {
  authorizeVerification,
  createQueuedResult,
  failQueuedResult,
  getVerificationResult,
  handleVerificationHttp,
  persistVerificationResult,
  runVerificationPipeline,
  storeVerificationOutput,
  type VerificationBucketLike,
} from "./verification";

export { CiSandbox };

export interface CiEnv extends CiBindings {
  PLATFORM_URL: string;
  WORKERS_SUBDOMAIN: string;
  /** Bearer for build reports; the platform holds the same value. */
  CI_REPORT_TOKEN: string;
  /** Dedicated bearer for POST/GET /verify; never shared with CI reports. */
  VERIFICATION_TOKEN: string;
  /** Separate Workflow class for credentialless, non-deploying self verification. */
  VERIFICATION_WORKFLOW: Workflow<VerificationRequest>;
  /** App D1 databases: `systemId` -> `database_name` -> account id (a JSON var; see deploy-config `parseD1DatabaseIds`). */
  D1_DATABASE_IDS?: unknown;
  /** systemId -> native binding name -> allowed Flagship app ID. */
  FLAGSHIP_APP_IDS?: unknown;
}

/** The engine's payload with the platform's params riding along (the engine ignores extra fields). */
type Payload = CiParams<CloudflareArtifacts> & { artyfact: CiBuildParams };
type VerificationPayload = CiParams<CloudflareArtifacts> & { verification: VerificationRequest };

/** Map the platform's params onto the engine's `CiParams` (Artifacts provider, push of `refs/heads/main`). */
export function toCiParams(p: CiBuildParams): Payload {
  return {
    provider: "cloudflare-artifacts", providerData: { namespace: p.namespace }, event: { type: "push" },
    owner: p.namespace, repo: p.repo, sha: p.commit, remote: "cloudflare", trigger: "push", ref: "refs/heads/main", branch: "main",
    artyfact: p,
  };
}

export function toVerificationCiParams(p: VerificationRequest): VerificationPayload {
  return {
    provider: "cloudflare-artifacts", providerData: { namespace: "artyfact" }, event: { type: "push" },
    owner: "artyfact", repo: p.source.repo, sha: p.source.commit, remote: "cloudflare", trigger: "push", ref: p.source.commit,
    verification: p,
  };
}

const bucket = (env: CiEnv) => env.BACKUP_BUCKET as unknown as VerificationBucketLike;
const isPlatformParams = (v: unknown): v is CiBuildParams => !!v && typeof v === "object" && "buildId" in v && "workerName" in v;
const isVerificationParams = (v: unknown): v is VerificationRequest => !!v && typeof v === "object" && "profile" in v && "source" in v && "genome" in v;

export class ArtyfactCI extends CIWorkflow<CloudflareArtifacts, CiEnv> {
  override async run(event: WorkflowEvent<CiWorkflowPayload<CloudflareArtifacts>>, step: WorkflowStep) {
    const raw: unknown = event.payload;
    const payload = isPlatformParams(raw) ? toCiParams(raw) : event.payload;
    return super.run({ ...event, payload } as WorkflowEvent<CiWorkflowPayload<CloudflareArtifacts>>, step);
  }

  protected async pipeline(event: WorkflowEvent<CiParams<CloudflareArtifacts>>, step: WorkflowStep, ci: CiContext): Promise<void> {
    const params = (event.payload as Partial<Payload>).artyfact;
    if (!params) throw new Error("artyfact-ci only runs builds started by the artyfact platform");
    await runPipeline({
      params, instanceId: event.instanceId,
      step: ((name: string, fn: () => Promise<unknown>) => step.do(name, fn as () => Promise<never>)) as DoStep,
      ci: ci as unknown as CiLike,
      fetch: ((url, init) => fetch(url, init)) as FetchLike,
      readFile: async (path) => {
        const repo = await this.env.ARTIFACTS.get(params.repo);
        const blob = await repo.readFile({ ref: params.commit, path });
        return blob ? blob.text() : null;
      },
      reportToken: this.env.CI_REPORT_TOKEN, platformUrl: this.env.PLATFORM_URL, workersSubdomain: this.env.WORKERS_SUBDOMAIN,
      accountId: this.env.CLOUDFLARE_ACCOUNT_ID, d1DatabaseIds: parseD1DatabaseIds(this.env.D1_DATABASE_IDS), flagshipAppIds: parseFlagshipAppIds(this.env.FLAGSHIP_APP_IDS),
    });
  }
}

async function authorizeFromArtifacts(env: CiEnv, request: VerificationRequest): Promise<void> {
  const effective = await readVerificationGenome(env.ARTIFACTS, request.genome);
  const pinnedRef = request.pinnedGenome ?? request.genome;
  const same = pinnedRef.repo === request.genome.repo && pinnedRef.commit === request.genome.commit && pinnedRef.prefix === request.genome.prefix;
  const pinned = same ? effective : await readVerificationGenome(env.ARTIFACTS, pinnedRef);
  authorizeVerification(request, effective, pinned);
}

export class ArtyfactVerification extends CIWorkflow<CloudflareArtifacts, CiEnv> {
  override async run(event: WorkflowEvent<CiWorkflowPayload<CloudflareArtifacts>>, step: WorkflowStep) {
    const raw: unknown = event.payload;
    const payload = isVerificationParams(raw) ? toVerificationCiParams(raw) : event.payload;
    return super.run({ ...event, payload } as WorkflowEvent<CiWorkflowPayload<CloudflareArtifacts>>, step);
  }

  protected async pipeline(event: WorkflowEvent<CiParams<CloudflareArtifacts>>, step: WorkflowStep, ci: CiContext): Promise<void> {
    const request = (event.payload as Partial<VerificationPayload>).verification;
    if (!request) throw new Error("artyfact verification only runs requests accepted by POST /verify");
    await runVerificationPipeline({
      request,
      authorize: () => step.do("authorize verification", () => authorizeFromArtifacts(this.env, request)),
      ci,
      now: (name) => step.do(name, async () => new Date().toISOString()),
      persist: (result, checkpoint) => step.do(checkpoint, () => persistVerificationResult(bucket(this.env), result)),
      storeOutput: (bytes) => step.do("store output", () => storeVerificationOutput(bucket(this.env), request.id, bytes)),
    });
  }
}

export default {
  async fetch(request: Request, env: CiEnv): Promise<Response> {
    if (new URL(request.url).pathname === "/health") return Response.json({ ok: true, service: "artyfact-ci" });
    return handleVerificationHttp(request, {
      token: env.VERIFICATION_TOKEN,
      authorize: (verification) => authorizeFromArtifacts(env, verification),
      getResult: (id) => getVerificationResult(bucket(env), id),
      createQueued: (result) => createQueuedResult(bucket(env), result),
      failQueued: (result) => failQueuedResult(bucket(env), result),
      start: async (verification) => { await env.VERIFICATION_WORKFLOW.create({ id: verification.id, params: verification }); },
      getOutput: async (key) => {
        const object = await env.BACKUP_BUCKET.get(key);
        return object ? new Response(object.body) : null;
      },
    });
  },
} satisfies ExportedHandler<CiEnv>;
