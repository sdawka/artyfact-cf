import { spawnSync } from "node:child_process";

export class CliError extends Error {}

/** Passes the bearer header via the environment so the token never appears in argv (visible to `ps`). */
export function gitEnv(token?: string, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!token) return { ...base };
  const n = Number.parseInt(base.GIT_CONFIG_COUNT ?? "0", 10) || 0;
  return {
    ...base,
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${n}`]: "http.extraHeader",
    [`GIT_CONFIG_VALUE_${n}`]: `Authorization: Bearer ${token}`,
  };
}

const ID_RE = /^[A-Za-z0-9._-]+$/;

/** Ids end up in URLs and git argv; reject anything that could be read as an option or path. */
export function assertId(kind: string, v: unknown): string {
  if (typeof v !== "string" || !ID_RE.test(v) || v.startsWith("-") || v === "." || v === "..")
    throw new CliError(`invalid ${kind}: ${JSON.stringify(v)}`);
  return v;
}

const ARTIFACTS_HOST_RE = /^[0-9a-f]{32}\.artifacts\.cloudflare\.net$/;
const REMOTE_PATH_RE = /^\/git\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.git$/;
// Artifacts tokens look like "art_v1_<hex>?expires=<unix>", so "?" and "&" are allowed.
const TOKEN_RE = /^[A-Za-z0-9._~+/=?&-]+$/;

/** The token is only ever sent to an Artifacts git remote; `ARTYFACT_ALLOW_REMOTE_HOST` opts one other host in (tests, local dev). */
export function assertRemote(kind: string, v: unknown, env: Record<string, string | undefined> = process.env): string {
  const bad = () => new CliError(`invalid ${kind}: must be https://<account>.artifacts.cloudflare.net/git/<namespace>/<repo>.git`);
  if (typeof v !== "string" || /\s/.test(v)) throw bad();
  let u: URL;
  try { u = new URL(v); } catch { throw bad(); }
  const hostOk = ARTIFACTS_HOST_RE.test(u.hostname) || (!!env.ARTYFACT_ALLOW_REMOTE_HOST && u.hostname === env.ARTYFACT_ALLOW_REMOTE_HOST);
  if (u.protocol !== "https:" || !hostOk || u.username || u.password || u.port || u.search || u.hash || !REMOTE_PATH_RE.test(u.pathname)) throw bad();
  return v;
}

/** Reject tokens that could break out of the Authorization header value (CR/LF etc). */
export function assertToken(v: string): string {
  if (!TOKEN_RE.test(v)) throw new CliError("ARTYFACT_TOKEN contains unexpected characters");
  return v;
}

export function isTracked(cwd: string, path: string): boolean {
  return spawnSync("git", ["ls-files", "--error-unmatch", "--", path], { cwd, stdio: "ignore" }).status === 0;
}

export function git(cwd: string, args: string[], token?: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: gitEnv(token) });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || "").replaceAll(token ?? "\0", "***").trim();
    throw new CliError(`git ${args[0]} failed: ${msg}`);
  }
  return r.stdout.trim();
}

export function isDirty(cwd: string): boolean {
  return git(cwd, ["status", "--porcelain"]) !== "";
}

/** Stage everything and commit when the tree is dirty; returns HEAD sha. */
export function commitIfDirty(cwd: string, message: string): string {
  if (isDirty(cwd)) {
    git(cwd, ["add", "-A"]);
    // Fall back to a neutral identity only when the user has none configured.
    const hasEmail = spawnSync("git", ["config", "user.email"], { cwd, encoding: "utf8" }).stdout.trim() !== "";
    const identity = hasEmail ? [] : ["-c", "user.name=artyfact", "-c", "user.email=artyfact@localhost"];
    git(cwd, [...identity, "commit", "-m", message, "--"]);
  }
  return git(cwd, ["rev-parse", "HEAD"]);
}
