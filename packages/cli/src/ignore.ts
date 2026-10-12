/** What never travels into a fork or a pushed repo: dependencies, Wrangler state, build output and local secret files. */

/** Wrangler and dotenv secret files (`.dev.vars`, `.dev.vars.staging`, `.env`, `.env.local`, ...); `*.example` is kept. */
export const isSecretFile = (base: string) => /^\.(dev\.vars|env)(\..+)?$/.test(base) && !base.endsWith(".example");

/** Directories checkpoint and submit never stage, whatever the repo's own ignore rules say. */
export const NEVER_STAGED_DIRS = ["node_modules", ".wrangler"] as const;

/** A repo-relative path checkpoint and submit never stage: node_modules or .wrangler (a directory or a symlink), anything in them, or a secret file. */
export function neverStaged(rel: string): boolean {
  const parts = rel.split("/");
  return parts.some((p) => (NEVER_STAGED_DIRS as readonly string[]).includes(p)) || isSecretFile(parts.at(-1)!);
}

/** Ignore patterns `start` appends to the clone's `.git/info/exclude` (the app scaffold's `.gitignore` has the same). */
export const WORKSPACE_IGNORES = ["node_modules", ".wrangler", "dist/", ".dev.vars*", ".env*", "!*.example"] as const;
