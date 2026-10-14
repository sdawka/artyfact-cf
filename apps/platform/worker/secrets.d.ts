// Secrets are not in wrangler.jsonc, so `wrangler types` does not emit them.
// Keep in sync with .dev.vars.example.
interface Secrets {
  /** Bearer token required for admin routes (import, promote, accept, reject). */
  ADMIN_TOKEN: string;
  /** System One providers, in this order: FAKE_S1=1 (local and tests only), TypeSafe, Clef (the AI binding), OpenRouter; none is off. */
  FAKE_S1?: string;
  /** `auto` (default: the order above) | `clef` | `jev` | `openrouter` | `fake` | `off`. An explicit one never falls through. */
  S1_PROVIDER?: string;
  TYPESAFE_API_KEY?: string;
  /** Jev model: `jev-latest` on TypeSafe, `typesafe/jev-1.13` on OpenRouter when only OPENROUTER_API_KEY is set. */
  JEV_MODEL?: string;
  /** Workers AI model id of Clef when the AI binding selects it; default @cf/cloudflare/clef (@cf/cloudflare/clef-flash is the 9B one). */
  CLEF_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  /** OpenRouter decision model; default perplexity/pplx-decider-v1.1-27b. */
  OPENROUTER_MODEL?: string;
  /** "0" turns the LLM translator and the plan draft planner off (the draft uses its deterministic partition). */
  TRANSLATE?: string;
  /** OpenRouter model of the intent translator; also the plan draft planner's when OPENROUTER_PLAN_MODEL is unset. */
  OPENROUTER_TRANSLATE_MODEL?: string;
  /** OpenRouter model of the plan draft planner. */
  OPENROUTER_PLAN_MODEL?: string;
  /** "1" lets the health hook fetch http://localhost / 127.0.0.1 previews. `.dev.vars` only, never deployed. */
  ALLOW_LOCAL_PREVIEW?: string;
  /** Bearer the artyfact-ci Workflow sends with build reports. */
  CI_REPORT_TOKEN?: string;
  /** Cloudflare API token CI passes to `wrangler deploy` for app Workers and the platform uses for event subscriptions. */
  CF_API_TOKEN?: string;
  /** JSON allowlist of System/artifact bindings to Cloudflare runtime and Flagship resources. */
  OPERATIONS_BINDINGS?: string;
  /** Server-only token for configured metrics and Flagship management. Never returned to clients. */
  OPERATIONS_API_TOKEN?: string;
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
  /**
   * Workers AI: selects Cloudflare Clef for System One and for visual checks. Browser Run: platform screenshots for
   * visual checks. Both are remote-only and local-only: `npm run dev` adds them (vite.config.ts); the deployed
   * wrangler.jsonc (the hosted demo) and wrangler.test.jsonc omit them, so they are optional here.
   */
  AI?: Ai;
  BROWSER?: BrowserRun;
}
declare namespace Cloudflare {
  interface Env extends Secrets {}
}
interface Env extends Secrets {}
