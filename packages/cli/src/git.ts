import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NEVER_STAGED_DIRS, neverStaged } from "./ignore.ts";

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
// The realization secret is 64 hex chars; it is only ever sent as a bearer header to the platform.
const SECRET_RE = /^[0-9a-f]{64}$/;
export function assertSecret(v: string): string {
  if (!SECRET_RE.test(v)) throw new CliError("realization secret must be 64 hex characters (ARTYFACT_SECRET or .artyfact.json)");
  return v;
}

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

/** No tracked change and no untracked file, ignored files aside. */
export function isPristine(cwd: string): boolean {
  return git(cwd, ["status", "--porcelain", "--untracked-files=all"]) === "";
}

/** The instruction blocks `start` / `task claim` merge into a tracked AGENTS.md (agents-md.ts). */
const INJECTED_BLOCK = /\n?<!-- (artyfact(?:-task)?):start -->\n[\s\S]*?<!-- \1:end -->\n?/g;

/**
 * A tracked AGENTS.md is staged without the injected blocks, so they never reach a candidate; the working tree keeps
 * them. Unstaged entirely when nothing else in it changed.
 */
function keepInjectedBlocksOut(cwd: string): void {
  const head = spawnSync("git", ["show", "HEAD:AGENTS.md"], { cwd, encoding: "utf8" });
  if (head.status !== 0 || !existsSync(join(cwd, "AGENTS.md"))) return;
  const strip = (s: string) => s.replace(INJECTED_BLOCK, "");
  const content = strip(readFileSync(join(cwd, "AGENTS.md"), "utf8"));
  if (content === strip(head.stdout)) {
    git(cwd, ["reset", "-q", "--", "AGENTS.md"]);
    return;
  }
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd, encoding: "utf8", input: content });
  if (blob.status !== 0) throw new CliError(`git hash-object failed: ${blob.stderr.trim()}`);
  const mode = git(cwd, ["ls-files", "-s", "--", "AGENTS.md"]).split(" ")[0]!;
  git(cwd, ["update-index", "--cacheinfo", `${mode},${blob.stdout.trim()},AGENTS.md`]);
}

/**
 * Stage every change except dependencies, Wrangler state and secret files, and commit when anything is staged; returns
 * HEAD sha. `note` hears which paths were left unstaged. The exclusion holds even in a repo without a `.gitignore`.
 * Injected AGENTS.md blocks stay out of the commit.
 */
export function commitIfDirty(cwd: string, message: string, note: (s: string) => void = () => {}): string {
  if (isDirty(cwd)) {
    git(cwd, ["add", "-A", "--", ".", ...NEVER_STAGED_DIRS.flatMap((d) => [`:(exclude,glob)**/${d}`, `:(exclude,glob)**/${d}/**`])]);
    const staged = git(cwd, ["diff", "--cached", "--name-only", "--no-renames", "-z"]).split("\0").filter(Boolean);
    const dropped = staged.filter(neverStaged);
    if (dropped.length) {
      git(cwd, ["--literal-pathspecs", "reset", "-q", "--", ...dropped]);
      note(`not staged (secret files are never committed): ${dropped.join(", ")}`);
    }
    if (staged.includes("AGENTS.md")) keepInjectedBlocksOut(cwd);
    if (spawnSync("git", ["diff", "--cached", "--quiet"], { cwd }).status === 1) {
      // Fall back to a neutral identity only when the user has none configured.
      const hasEmail = spawnSync("git", ["config", "user.email"], { cwd, encoding: "utf8" }).stdout.trim() !== "";
      const identity = hasEmail ? [] : ["-c", "user.name=artyfact", "-c", "user.email=artyfact@localhost"];
      git(cwd, [...identity, "commit", "-m", message, "--"]);
    }
  }
  return git(cwd, ["rev-parse", "HEAD"]);
}
