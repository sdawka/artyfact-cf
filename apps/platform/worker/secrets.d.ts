// Secrets are not in wrangler.jsonc, so `wrangler types` does not emit them.
// Keep in sync with .dev.vars.example.
interface Secrets {
  /** Bearer token required for admin routes (import, promote, accept, reject). */
  ADMIN_TOKEN: string;
  TYPESAFE_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  /** "1" lets the health hook fetch http://localhost / 127.0.0.1 previews. `.dev.vars` only, never deployed. */
  ALLOW_LOCAL_PREVIEW?: string;
}
declare namespace Cloudflare {
  interface Env extends Secrets {}
}
interface Env extends Secrets {}
