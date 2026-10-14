/**
 * The hosted demo (`HOSTED_DEMO=1`, set in the deployed wrangler.jsonc vars). The hosted Worker has no spending gate,
 * so it never calls a paid or external model and never reads a model key or binding: System One is the simulated
 * provider (the fake's canned answers, recorded as `simulated`), visual checks record a simulated verdict without
 * Browser Run or Clef, and intent translation and the plan draft planner are the deterministic fakes. Local runs
 * (`npm run dev` with `.dev.vars`) leave it unset and use the real providers.
 */
import { fakeTranslator, simulatedSystemOne, type SystemOne, type Translator } from "@artyfact/ontology";

export const isHostedDemo = (env: { HOSTED_DEMO?: string }): boolean => env.HOSTED_DEMO === "1";

export const HOSTED_DEMO_NOTICE = "Hosted demo: judgments are simulated. Run it locally on your Cloudflare account for Clef or Jev.";

/** The demo's model clients. Built from nothing in env, so no key or binding can be read through them. */
export const demoModels = (): { s1: SystemOne; translator: Translator } => ({ s1: simulatedSystemOne(), translator: fakeTranslator() });
