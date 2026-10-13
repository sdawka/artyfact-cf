export interface Env {
  DB: D1Database;
  BUILD_ID?: string;
  ARTYFACT_SOURCE_COMMIT?: string;
  ARTYFACT_GENOME_COMMIT?: string;
  /** Phenome reporting (set by CI as --var). Without ARTYFACT_PLATFORM_URL no events are sent. */
  ARTYFACT_PLATFORM_URL?: string;
  ARTYFACT_SYSTEM_ID?: string;
  ARTYFACT_THING_ID?: string;
  ARTYFACT_ARTIFACT_ID?: string;
  ARTYFACT_DEPLOYMENT_ID?: string;
  ARTYFACT_INGEST_TOKEN?: string;
  /** Cloudflare Access application AUD and team domain (e.g. team.cloudflareaccess.com); set when deployed. */
  ACCESS_AUD?: string;
  ACCESS_TEAM_DOMAIN?: string;
  /** "1" accepts the x-owner header as identity. Local dev and tests only. */
  DEV_AUTH_HEADER?: string;
}
