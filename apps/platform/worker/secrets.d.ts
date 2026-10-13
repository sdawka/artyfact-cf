// Secrets are not in wrangler.jsonc, so `wrangler types` does not emit them.
// Keep in sync with .dev.vars.example.
interface Secrets {
  /** Bearer token required for admin routes (import, promote, accept, reject). */
  ADMIN_TOKEN: string;
  /** System One providers, in this order: FAKE_S1=1 (local and tests only), TypeSafe, OpenRouter; none is off. */
  FAKE_S1?: string;
  TYPESAFE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  /** OpenRouter decision model; default perplexity/pplx-decider-v1.1-27b. */
  OPENROUTER_MODEL?: string;
  /** "1" lets the health hook fetch http://localhost / 127.0.0.1 previews. `.dev.vars` only, never deployed. */
  ALLOW_LOCAL_PREVIEW?: string;
  /** Bearer the artyfact-ci Workflow sends with build reports. */
  CI_REPORT_TOKEN?: string;
  /** Cloudflare API token CI passes to `wrangler deploy` for app Workers and the platform uses for event subscriptions. */
  CF_API_TOKEN?: string;
  /** Queue id of artyfact-artifacts-events, the target of per-fork Artifacts event subscriptions. */
  EVENTS_QUEUE_ID?: string;
  /** "1" runs the backend on in-memory Artifacts seeded from examples/ (see worker/artifacts/fake-platform.ts). Local only. */
  FAKE_ARTIFACTS?: string;
  /** With FAKE_ARTIFACTS=1: `peopling` (default), `artyfact` (the repo-root genome/) or `both`. */
  FAKE_SEED?: string;
  /**
   * Cross-script Workflows binding to artyfact-ci (wrangler.jsonc `workflows`). Typed here as optional because
   * wrangler.test.jsonc omits it; `wrangler types` emits it as required, so drop that generated line after regenerating.
   */
  CI?: Workflow<import("../shared/api").CiBuildParams>;
}
declare namespace Cloudflare {
  interface Env extends Secrets {}
}
interface Env extends Secrets {}
