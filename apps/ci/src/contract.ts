/**
 * The wire contract between the platform and this Worker. Mirrors `apps/platform/shared/api.ts`
 * (`CiBuildParams`, `BuildReport`); keep the two in sync. The Worker cannot import the platform package.
 */

export type BuildStatus = "queued" | "running" | "passed" | "failed" | "error";
export type BuildKind = "preview" | "production";

/** Parameters the platform passes to the `artyfact-ci` Workflow (`env.CI.create({ id, params })`). */
export interface CiBuildParams {
  thingId?: string;
  artifactId?: string;
  genomeCommit?: string;
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
  /** Deployed as `--var KEY:VALUE` (`BUILD_ID` identifies the build), except the credentials in `SECRET_VARS` (`deploy-config.ts`), which become Worker secrets. */
  vars: Record<string, string>;
  /** Each one of {@link ALLOWED_COMMANDS}; `deploy` only names the step (the pinned image Wrangler always deploys). */
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
  output?: { locator?: string; digest?: string };
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

/**
 * The only commands a build may run, chosen by the platform from template defaults. Mirrors `ALLOWED_COMMANDS` in
 * `apps/platform/worker/deployments.ts`; the Worker re-checks so a bad dispatch cannot widen it.
 */
export const ALLOWED_COMMANDS = {
  install: ["npm install", "npm ci"],
  test: ["npm test", "npm run test"],
  build: ["npm run build"],
  deploy: ["npx wrangler deploy", "wrangler deploy"],
} as const satisfies Record<keyof CiBuildParams["commands"], readonly string[]>;
