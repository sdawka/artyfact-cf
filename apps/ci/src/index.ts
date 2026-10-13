/**
 * artyfact-ci: builds and deploys app commits for the artyfact platform. The platform starts the `artyfact-ci`
 * Workflow itself (cross-script Workflows binding) with {@link CiBuildParams}; no push trigger is configured.
 */
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { CIWorkflow, type CiContext, type CiParams, type CloudflareArtifacts, type CiWorkflowPayload } from "@cloudflare/ci";
import { CiSandbox, type CiBindings } from "@cloudflare/ci/worker";
import type { CiBuildParams } from "./contract";
import { parseD1DatabaseIds } from "./deploy-config";
import { runPipeline, type CiLike, type DoStep, type FetchLike } from "./pipeline";

export { CiSandbox };

export interface CiEnv extends CiBindings {
  PLATFORM_URL: string;
  WORKERS_SUBDOMAIN: string;
  /** Bearer for build reports; the platform holds the same value. */
  CI_REPORT_TOKEN: string;
  /** App D1 databases: `systemId` -> `database_name` -> account id (a JSON var; see deploy-config `parseD1DatabaseIds`). */
  D1_DATABASE_IDS?: unknown;
}

/** The engine's payload with the platform's params riding along (the engine ignores extra fields). */
type Payload = CiParams<CloudflareArtifacts> & { artyfact: CiBuildParams };

/** Map the platform's params onto the engine's `CiParams` (Artifacts provider, push of `refs/heads/main`). */
export function toCiParams(p: CiBuildParams): Payload {
  return {
    provider: "cloudflare-artifacts", providerData: { namespace: p.namespace }, event: { type: "push" },
    owner: p.namespace, repo: p.repo, sha: p.commit, remote: "cloudflare", trigger: "push", ref: "refs/heads/main", branch: "main",
    artyfact: p,
  };
}

const isPlatformParams = (v: unknown): v is CiBuildParams => !!v && typeof v === "object" && "buildId" in v && "workerName" in v;

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
      accountId: this.env.CLOUDFLARE_ACCOUNT_ID, d1DatabaseIds: parseD1DatabaseIds(this.env.D1_DATABASE_IDS),
    });
  }
}

export default {
  fetch: (request: Request) =>
    new URL(request.url).pathname === "/health" ? Response.json({ ok: true, service: "artyfact-ci" }) : new Response("not found", { status: 404 }),
} satisfies ExportedHandler<CiEnv>;
