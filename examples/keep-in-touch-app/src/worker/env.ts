export interface Env {
  DB: D1Database;
  BUILD_ID?: string;
  /** Cloudflare Access application AUD and team domain (e.g. team.cloudflareaccess.com); set when deployed. */
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  /** "1" accepts the x-owner header as identity. Local dev and tests only. */
  DEV_AUTH_HEADER?: string;
}
