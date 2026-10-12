/**
 * The deploy half of the pipeline, built so that nothing from the app repo runs while credentials are present.
 *
 * The repo's Wrangler config is read at the commit by the Worker (not in the sandbox), checked against an allowlist
 * of self-contained keys, and turned into two platform-written configs:
 *  - bundle: the pinned image Wrangler bundles the repo with `--dry-run --outdir` in a step that holds no secrets
 *    (bundling can read any file the sandbox can, e.g. `import x from "/proc/self/environ" with { type: "text" }`);
 *  - deploy: the same Wrangler uploads that output with `no_bundle`, so the credentialed step never runs esbuild,
 *    npm, a repo script or anything on a repo-controlled PATH.
 * See docs/ci.md "Trust model".
 */
import { posix } from "node:path";

/** Wrapper installed by the Dockerfile: absolute node running the pinned global Wrangler. */
export const WRANGLER = "/opt/artyfact/bin/wrangler";
export const SAFE_PATH = "/usr/local/bin:/usr/bin:/bin";
export const WORKSPACE = "/workspace";
export const CF_API_BASE_URL = "https://api.cloudflare.com/client/v4";
/** Wrangler's own lookup order. */
export const CONFIG_FILES = ["wrangler.json", "wrangler.jsonc", "wrangler.toml"] as const;
/** `vars` entries that are credentials: uploaded as Worker secrets on the deploy step only, never as `--var`. */
export const SECRET_VARS: ReadonlySet<string> = new Set(["ARTYFACT_INGEST_TOKEN"]);
/** Env names the runner passes the generated config and secrets in (redacted from step notifications). */
export const CONFIG_ENV = "ARTYFACT_WRANGLER_CONFIG";
export const SECRETS_ENV = "ARTYFACT_DEPLOY_SECRETS";

/** The repo config cannot be deployed safely; the build fails (not errors) with this message. */
export class DeployRefused extends Error {
  override name = "DeployRefused";
}

/** Keys copied into both generated configs after validation. */
const COPIED = [
  "compatibility_date", "compatibility_flags", "vars", "durable_objects", "migrations", "d1_databases", "triggers",
  "observability", "placement", "limits", "workers_dev", "preview_urls", "keep_vars",
] as const;
/** Keys that only affect bundling (bundle config only). */
const BUNDLE_ONLY = ["define", "minify", "jsx_factory", "jsx_fragment", "tsconfig"] as const;
/** Keys accepted but not used: the platform sets the name and account; `dev` and `env.*` never apply here. */
const IGNORED = ["$schema", "name", "account_id", "dev", "env", "send_metrics"] as const;
const SPECIAL = ["main", "assets"] as const;
const ALLOWED = new Set<string>([...COPIED, ...BUNDLE_ONLY, ...IGNORED, ...SPECIAL]);

/** Why the common unsupported keys are refused; anything else not in the allowlist gets a generic reason. */
const REFUSED: Record<string, string> = {
  build: "custom builds run repo commands with credentials present",
  rules: "module rules can pull files from outside the repo into the upload",
  alias: "aliases can pull files from outside the repo into the upload",
  find_additional_modules: "module discovery is controlled by the platform",
  base_dir: "module discovery is controlled by the platform",
  no_bundle: "bundling is controlled by the platform",
  preserve_file_names: "module discovery is controlled by the platform",
  containers: "container images build repo Dockerfiles with credentials present",
  site: "Workers Sites is not supported; use assets",
  wasm_modules: "file-path bindings can read outside the repo",
  text_blobs: "file-path bindings can read outside the repo",
  data_blobs: "file-path bindings can read outside the repo",
  routes: "routes and custom domains are not available to app Workers",
  route: "routes and custom domains are not available to app Workers",
  tail_consumers: "a tail consumer receives another Worker's logs",
  services: "service bindings reach other Workers in the account",
  kv_namespaces: "bindings to existing account resources are not available to app Workers",
  workflows: "Workflow names are account-wide, so an app could take over another Worker's Workflow",
  r2_buckets: "bindings to existing account resources are not available to app Workers",
  queues: "bindings to existing account resources are not available to app Workers",
  unsafe: "unsafe bindings are not available to app Workers",
  secrets: "secrets are set by the platform",
};

/** Durable Object migration fields an app may use; `transferred_classes` / `from_script` move another Worker's state. */
const MIGRATION_KEYS: ReadonlySet<string> = new Set(["tag", "new_classes", "new_sqlite_classes", "renamed_classes", "deleted_classes"]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A repo-relative path that stays inside the repo (no absolute paths, no `..` escapes, no NUL). */
function insideRepo(path: unknown): string | null {
  if (typeof path !== "string" || !path.trim() || path.includes("\0") || posix.isAbsolute(path)) return null;
  const n = posix.normalize(path);
  return n === ".." || n.startsWith("../") ? null : n.replace(/\/+$/, "") || ".";
}

/** JSON with comments and trailing commas (the `wrangler.jsonc` dialect). */
export function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 1;
      out += " ";
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** The validated, deployable subset of a repo Wrangler config. Paths are repo-relative. */
export interface DeploySpec {
  file: string;
  main: string;
  assets?: Record<string, unknown> & { directory: string };
  copied: Record<string, unknown>;
  bundleOnly: Record<string, unknown>;
}

/**
 * Check the repo config against the allowlist. Every problem is reported at once; `build.command` gets its own
 * explicit reason because it is the common way to ask Wrangler to run a repo command during deploy.
 */
export function validateRepoConfig(file: string, text: string, opts: { accountId: string }): DeploySpec {
  if (file.endsWith(".toml")) throw new DeployRefused(`${file}: artyfact CI deploys from wrangler.json or wrangler.jsonc only`);
  let raw: unknown;
  try {
    raw = parseJsonc(text);
  } catch (e) {
    throw new DeployRefused(`${file} is not valid JSON(C): ${(e as Error).message}`);
  }
  if (!isObj(raw)) throw new DeployRefused(`${file} must hold an object`);
  const problems: string[] = [];
  const build = raw.build;
  if (isObj(build) && build.command !== undefined) {
    problems.push("build.command is set: artyfact CI never runs a Wrangler custom build during deploy; move it to the template's build step");
  }
  for (const key of Object.keys(raw)) {
    if (key === "build" && isObj(build) && build.command !== undefined) continue;
    if (!ALLOWED.has(key)) problems.push(`${key} is not supported (${REFUSED[key] ?? "not on the artyfact CI allowlist"})`);
  }
  if (raw.account_id !== undefined && raw.account_id !== opts.accountId) problems.push("account_id names another account");

  const main = insideRepo(raw.main);
  if (!main) problems.push("main must be a path inside the repo");
  let assets: DeploySpec["assets"];
  if (raw.assets !== undefined) {
    const dir = isObj(raw.assets) ? insideRepo(raw.assets.directory) : null;
    if (!dir) problems.push("assets.directory must be a path inside the repo");
    else assets = { ...(raw.assets as Record<string, unknown>), directory: dir };
  }
  if (raw.tsconfig !== undefined && !insideRepo(raw.tsconfig)) problems.push("tsconfig must be a path inside the repo");

  const durable = raw.durable_objects;
  if (durable !== undefined) {
    const bindings = isObj(durable) && Array.isArray(durable.bindings) ? durable.bindings : null;
    if (!bindings) problems.push("durable_objects.bindings must be a list");
    for (const b of bindings ?? []) {
      if (!isObj(b) || typeof b.name !== "string" || typeof b.class_name !== "string") problems.push("each durable_objects binding needs name and class_name");
      else if (b.script_name !== undefined || b.environment !== undefined) problems.push(`durable_objects ${b.name} binds another Worker's class`);
    }
  }
  if (raw.migrations !== undefined) {
    if (!Array.isArray(raw.migrations)) problems.push("migrations must be a list");
    for (const m of Array.isArray(raw.migrations) ? raw.migrations : []) {
      if (!isObj(m)) {
        problems.push("each migration must be an object");
        continue;
      }
      for (const k of Object.keys(m)) {
        if (!MIGRATION_KEYS.has(k)) problems.push(`migration ${String(m.tag)}: ${k} is not supported (only ${[...MIGRATION_KEYS].join(", ")})`);
      }
      for (const r of Array.isArray(m.renamed_classes) ? m.renamed_classes : []) {
        if (isObj(r) && r.from_script !== undefined) problems.push(`migration ${String(m.tag)}: from_script pulls another Worker's Durable Object state`);
      }
    }
  }
  if (raw.vars !== undefined) {
    if (!isObj(raw.vars)) problems.push("vars must be an object");
    for (const k of Object.keys(isObj(raw.vars) ? raw.vars : {})) if (SECRET_VARS.has(k)) problems.push(`vars.${k} is set by the platform`);
  }
  if (problems.length || !main) throw new DeployRefused(`refusing to deploy ${file}: ${problems.join("; ")}`);

  const pick = (keys: readonly string[]) => Object.fromEntries(keys.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]]));
  return { file, main, ...(assets && { assets }), copied: pick(COPIED), bundleOnly: pick(BUNDLE_ONLY) };
}

const abs = (rel: string) => (rel === "." ? WORKSPACE : `${WORKSPACE}/${rel}`);

/** `/workspace/.artyfact-build-<nonce>`: unguessable, so no tracked or installed file can sit there in advance. */
export const distDir = (nonce: string) => `${WORKSPACE}/.artyfact-build-${nonce}`;
/** Wrangler names the bundled entry after `main`'s basename with a `.js` extension. */
export const distEntry = (spec: DeploySpec, nonce: string) => `${distDir(nonce)}/${posix.basename(spec.main).replace(/\.[^.]+$/, "")}.js`;

/** Config for the credential-free bundle step. Assets are left out (bundling does not read them). */
export function bundleConfig(spec: DeploySpec, o: { workerName: string; accountId: string }): Record<string, unknown> {
  const tsconfig = spec.bundleOnly.tsconfig as string | undefined;
  return {
    name: o.workerName, account_id: o.accountId, main: abs(spec.main), ...spec.copied, ...spec.bundleOnly,
    ...(tsconfig && { tsconfig: abs(insideRepo(tsconfig)!) }),
  };
}

/** Config for the credentialed deploy step: uploads the bundle output as-is (`no_bundle`). */
export function deployConfig(spec: DeploySpec, o: { workerName: string; accountId: string; nonce: string }): Record<string, unknown> {
  return {
    name: o.workerName, account_id: o.accountId, main: distEntry(spec, o.nonce), no_bundle: true, ...spec.copied,
    ...(spec.assets && { assets: { ...spec.assets, directory: abs(spec.assets.directory) } }),
  };
}

/** POSIX single-quoting: the value reaches the command verbatim. */
export const shQuote = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;

/** `env -i` with only what Wrangler needs: no NODE_OPTIONS, NPM_CONFIG_*, repo PATH or `.env`-supplied overrides. */
function cleanEnv(home: string, extra: string[] = []): string {
  return ["/usr/bin/env", "-i", `PATH=${SAFE_PATH}`, `HOME=${home}`, "CI=true", "WRANGLER_SEND_METRICS=false", ...extra].join(" ");
}

const refuse = (why: string) => `{ echo ${shQuote(`artyfact: refusing to deploy: ${why}`)} >&2; exit 97; }`;
const noSymlinks = (dir: string, what: string) => `[ -z "$(find ${dir} -type l -print -quit)" ] || ${refuse(`${what} contains a symlink`)}`;

/** Every script starts here: fail fast, and resolve tools from the image's system PATH only. */
const PRELUDE = ["set -eu", `export PATH=${SAFE_PATH}`, "unset NODE_OPTIONS NODE_PATH"];

/** Step 1: bundle the repo with the pinned Wrangler, no credentials. Writes only `distDir(nonce)`. */
export function bundleCommand(nonce: string): string {
  const dir = shQuote(distDir(nonce));
  const tmp = shQuote(`/tmp/artyfact-${nonce}`);
  return [
    ...PRELUDE,
    `rm -rf ${dir} ${tmp}`,
    `mkdir -p ${tmp}`,
    `cd ${tmp}`,
    `printf '%s' "$${CONFIG_ENV}" > wrangler.json`,
    `${cleanEnv(tmp)} ${WRANGLER} deploy --dry-run --config ${tmp}/wrangler.json --outdir ${dir} --env-file=/dev/null --autoconfig=false`,
  ].join("\n");
}

/**
 * Step 2: upload the bundle with credentials. Refuses symlinks in the bundle or assets and an assets directory that
 * resolves outside the workspace; plain vars go as `--var`, secrets as a `--secrets-file` written to a private
 * temp dir. Only `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` cross into Wrangler's environment.
 */
export function deployCommand(spec: DeploySpec, o: { nonce: string; workerName: string; vars: Record<string, string>; hasSecrets: boolean }): string {
  const dir = shQuote(distDir(o.nonce));
  const entry = shQuote(distEntry(spec, o.nonce));
  const lines = [...PRELUDE, `[ -f ${entry} ] || ${refuse("bundle output is missing")}`, noSymlinks(dir, "bundle output")];
  if (spec.assets) {
    lines.push(
      `A=$(realpath -e ${shQuote(abs(spec.assets.directory))}) || ${refuse("assets directory is missing")}`,
      `case "$A/" in ${WORKSPACE}/*) ;; *) ${refuse("assets directory resolves outside the repo")} ;; esac`,
      noSymlinks(`"$A"`, "assets directory"),
    );
  }
  lines.push(`C=$(mktemp -d /tmp/artyfact-deploy-XXXXXX)`, `cd "$C"`, `printf '%s' "$${CONFIG_ENV}" > wrangler.json`);
  if (o.hasSecrets) lines.push(`(umask 077 && printf '%s' "$${SECRETS_ENV}" > secrets.json)`);
  const vars = Object.entries(o.vars).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `--var ${shQuote(`${k}:${v}`)}`);
  const env = cleanEnv(`"$C"`, [
    `CLOUDFLARE_API_BASE_URL=${CF_API_BASE_URL}`, `CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN"`, `CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID"`,
  ]);
  lines.push([
    env, WRANGLER, "deploy", `--config "$C/wrangler.json"`, "--name", shQuote(o.workerName), ...vars,
    ...(o.hasSecrets ? [`--secrets-file "$C/secrets.json"`] : []), "--env-file=/dev/null", "--autoconfig=false",
  ].join(" "));
  return lines.join("\n");
}
