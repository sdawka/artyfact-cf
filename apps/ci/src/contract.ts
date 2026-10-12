/**
 * The wire contract between the platform and this Worker. Mirrors `apps/platform/shared/api.ts`
 * (`CiBuildParams`, `BuildReport`); keep the two in sync. The Worker cannot import the platform package.
 */

export type BuildStatus = "queued" | "running" | "passed" | "failed" | "error";
export type BuildKind = "preview" | "production";

/** Parameters the platform passes to the `artyfact-ci` Workflow (`env.CI.create({ id, params })`). */
export interface CiBuildParams {
  /** The platform's build row id; every report carries it. */
  buildId: string;
  systemId: string;
  realizationId: string | null;
  candidateId: string | null;
  /** Artifacts namespace and repo holding `commit` (a realization fork, or the app repo for production). */
  namespace: string;
  repo: string;
  commit: string;
  kind: BuildKind;
  /** `<slug>-app-r<N>` for a preview, `<slug>-app` for production. */
  workerName: string;
  /** Deployed as `--var KEY:VALUE`; `BUILD_ID` is always the commit. */
  vars: Record<string, string>;
  commands: { install: string; test?: string; build?: string; deploy: string };
  /** Where the Workflow posts {@link BuildReport}s (must be under the Worker's `PLATFORM_URL`). */
  reportUrl: string;
  deploymentId?: string;
}

export interface BuildStep {
  name: string;
  status: BuildStatus;
  durationMs?: number;
  logsUrl?: string;
}

export interface BuildReport {
  id?: string;
  status: BuildStatus;
  kind?: BuildKind;
  commit: string;
  url?: string;
  buildId?: string;
  logsUrl?: string;
  externalId?: string;
  deploymentId?: string;
  steps?: BuildStep[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}
