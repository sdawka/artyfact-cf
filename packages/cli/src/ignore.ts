/** What never travels into a fork or a pushed repo: dependencies, Wrangler state, build output and local secret files. */

/** Wrangler and dotenv secret files (`.dev.vars`, `.dev.vars.staging`, `.env`, `.env.local`, ...); `*.example` is kept. */
export const isSecretFile = (base: string) => /^\.(dev\.vars|env)(\..+)?$/.test(base) && !base.endsWith(".example");

/** Directories checkpoint and submit never stage, whatever the repo's own ignore rules say. */
export const NEVER_STAGED_DIRS = ["node_modules", ".wrangler"] as const;

/** CLI files holding attempt credentials (the task config's legacy root location, and `start`'s config). */
export const CREDENTIAL_FILES = [".artyfact-task.json", ".artyfact.json"] as const;

/** A repo-relative path checkpoint and submit never stage: node_modules or .wrangler (a directory or a symlink), anything in them, a secret file or a credential file. */
export function neverStaged(rel: string): boolean {
  const parts = rel.split("/"), base = parts.at(-1)!;
  return parts.some((p) => (NEVER_STAGED_DIRS as readonly string[]).includes(p)) || isSecretFile(base) || (CREDENTIAL_FILES as readonly string[]).includes(base);
}

/** Ignore patterns `start` appends to the clone's `.git/info/exclude` (the app scaffold's `.gitignore` has the same). */
export const WORKSPACE_IGNORES = ["node_modules", ".wrangler", "dist/", ".dev.vars*", ".env*", "!*.example"] as const;
