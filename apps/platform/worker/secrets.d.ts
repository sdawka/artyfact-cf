// Secrets are not in wrangler.jsonc, so `wrangler types` does not emit them.
// Keep in sync with .dev.vars.example.
interface Secrets {
  /** Bearer token required for accept/promote. */
  ADMIN_TOKEN: string;
  TYPESAFE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  /** "1" enables the fake System One semantic judge. */
  FAKE_S1?: string;
}
declare namespace Cloudflare {
  interface Env extends Secrets {}
}
interface Env extends Secrets {}
