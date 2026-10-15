/**
 * Account-level Artifacts operations `artyfact init` needs, behind an interface so tests run against local bare repos.
 * The real implementation shells out to wrangler (namespaces, repos, tokens) and `cf` (namespace create, fork).
 * Tokens come back on stdout and are returned to the caller; nothing here prints them or puts them on an argv.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CliError } from "./git.ts";
import { assertName } from "./safety.ts";

export interface Cloud {
  /** The account both CLIs are logged in to (throws when they disagree). */
  account(): string;
  /** The confirmed account id, once {@link account} ran (used to shorten it in error text). */
  accountId?(): string | undefined;
  ensureNamespace(ns: string): "exists" | "created";
  repoExists(ns: string, repo: string): boolean;
  createRepo(ns: string, repo: string): void;
  /** Short-lived repo-scoped token (`plaintext`). */
  token(ns: string, repo: string, scope: "read" | "write"): string;
  /** Fork `src` as `dst` (whole repo, default branch). The fork completes asynchronously; init polls until it is readable. */
  fork(ns: string, src: string, dst: string): void;
  remote(ns: string, repo: string): string;
}

export interface Proc { status: number | null; stdout: string; stderr: string }
export type Exec = (cmd: string, args: string[], env?: Record<string, string | undefined>) => Proc;

export const spawnExec = (cwd: string): Exec => (cmd, args, env) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  if (r.error) return { status: 127, stdout: "", stderr: r.error.message };
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

const ACCOUNT_RE = /^[0-9a-f]{32}$/;

const here = dirname(fileURLToPath(import.meta.url));
/** The monorepo root when this package runs from a checkout (src/ or dist/ are both three levels down). */
const monorepoRoot = () => resolve(here, "../../..");
/** Where pnpm links wrangler in the monorepo: the platform workspace, never the root (strict linking). */
export const PLATFORM_WRANGLER = "apps/platform/node_modules/wrangler/bin/wrangler.js";

/**
 * The wrangler entry point to run with `process.execPath`: the one resolvable from `cwd` (a user project), else the
 * monorepo's platform workspace. Never `npx`, which has no root bin under pnpm and would fetch from the registry.
 */
export function wranglerBin(cwd: string): string | null {
  try {
    return createRequire(join(cwd, "noop.js")).resolve("wrangler/bin/wrangler.js");
  } catch {
    const inRepo = join(monorepoRoot(), PLATFORM_WRANGLER);
    return existsSync(inRepo) ? inRepo : null;
  }
}

/** `[node, wrangler.js]` for {@link wranglerBin}, or a bare `wrangler` from PATH when none is installed near `cwd`. */
export function wranglerCommand(cwd: string): string[] {
  const bin = wranglerBin(cwd);
  return bin ? [process.execPath, bin] : ["wrangler"];
}

/** First JSON value in `text` (npx/wrangler may print banners before it). */
function jsonOf<T>(text: string, what: string): T {
  const i = text.search(/[[{]/);
  try {
    return JSON.parse(i < 0 ? text : text.slice(i)) as T;
  } catch {
    throw new CliError(`could not parse ${what} output as JSON`);
  }
}

/** Never echo a CLI's output when it may contain a token; keep only lines without one. */
const scrubbed = (s: string) => s.split("\n").filter((l) => !/token|plaintext|art_v1_/i.test(l)).join("\n").trim();

export function accountIds(whoami: unknown): string[] {
  const accounts = (whoami as { accounts?: { id?: unknown }[] } | null)?.accounts ?? [];
  return accounts.map((a) => a.id).filter((id): id is string => typeof id === "string" && ACCOUNT_RE.test(id));
}

/** Pick the account both CLIs see: `CLOUDFLARE_ACCOUNT_ID`/`ACCOUNT_ID` when set, else the single shared one. */
export function agreeOnAccount(wrangler: string[], cf: string[], preferred?: string): string {
  if (!wrangler.length) throw new CliError("wrangler is not logged in; run `wrangler login`");
  if (!cf.length) throw new CliError("cf is not logged in; run `cf auth login`");
  const shared = wrangler.filter((id) => cf.includes(id));
  if (preferred) {
    if (!shared.includes(preferred)) throw new CliError(`account ${preferred.slice(0, 8)}… is not visible to both wrangler and cf`);
    return preferred;
  }
  if (shared.length === 1) return shared[0]!;
  if (!shared.length) throw new CliError("wrangler and cf are logged in to different accounts; log one of them in again");
  throw new CliError("several accounts are visible; set CLOUDFLARE_ACCOUNT_ID to choose one");
}

export function cloudCli(exec: Exec, env: Record<string, string | undefined>, wranglerCmd: string[] = wranglerCommand(process.cwd())): Cloud {
  let accountId: string | undefined;
  const childEnv = () => (accountId ? { CLOUDFLARE_ACCOUNT_ID: accountId } : {});
  const [wranglerExe, ...wranglerPrefix] = wranglerCmd as [string, ...string[]];
  const wrangler = (...args: string[]) => exec(wranglerExe, [...wranglerPrefix, ...args], childEnv());
  const cf = (...args: string[]) => exec("cf", args, childEnv());
  // Every namespace and repo name is checked before it reaches an argv (never an option, never a path step).
  const ok = (ns: string, ...repos: string[]) => {
    assertName("namespace", ns);
    for (const r of repos) assertName("repo name", r);
  };
  const must = (p: Proc, what: string) => {
    if (p.status !== 0) {
      const detail = scrubbed(p.stderr || p.stdout) || `exit ${p.status}`;
      throw new CliError(`${what} failed: ${accountId ? detail.replaceAll(accountId, `${accountId.slice(0, 8)}…`) : detail}`);
    }
    return p;
  };
  const listsNamespace = (ns: string): boolean => {
    const l = cf("artifacts", "namespaces", "list");
    if (l.status !== 0) return false;
    try {
      return jsonOf<{ namespace?: unknown }[]>(l.stdout, "cf artifacts namespaces list").some((n) => n?.namespace === ns);
    } catch {
      return false;
    }
  };
  return {
    accountId: () => accountId,
    account() {
      const w = must(wrangler("whoami", "--json"), "wrangler whoami");
      const c = must(cf("auth", "whoami"), "cf auth whoami");
      accountId = agreeOnAccount(accountIds(jsonOf(w.stdout, "wrangler whoami")), accountIds(jsonOf(c.stdout, "cf auth whoami")),
        env.CLOUDFLARE_ACCOUNT_ID || env.ACCOUNT_ID || undefined);
      return accountId;
    },
    ensureNamespace(ns) {
      ok(ns);
      // `namespaces get` has answered "Access denied" (10004) for an existing namespace. An empty repo list proves
      // nothing, so the fallback is create. A failed create counts as "exists" only when the namespace is listed.
      if (wrangler("artifacts", "namespaces", "get", ns).status === 0) return "exists";
      const c = cf("artifacts", "namespaces", "create", "--body", JSON.stringify({ namespace: ns }));
      if (c.status === 0) return "created";
      const text = `${c.stderr}\n${c.stdout}`;
      // Real answer for an existing namespace: `[10201] Namespace already exists`, 409 Conflict.
      const saysExists = /\[10201\]/.test(text) || /namespace already exists/i.test(text);
      if (listsNamespace(ns)) return "exists";
      if (saysExists) throw new CliError(`cf artifacts namespaces create ${ns}: the API says it exists, but cf artifacts namespaces list does not show it`);
      must(c, `cf artifacts namespaces create ${ns}`);
      return "created";
    },
    repoExists: (ns, repo) => (ok(ns, repo), wrangler("artifacts", "repos", "get", repo, "--namespace", ns).status === 0),
    createRepo(ns, repo) {
      ok(ns, repo);
      must(wrangler("artifacts", "repos", "create", repo, "--namespace", ns, "--json"), `wrangler artifacts repos create ${repo}`);
    },
    token(ns, repo, scope) {
      ok(ns, repo);
      const p = must(wrangler("artifacts", "repos", "issue-token", repo, "--namespace", ns, "--scope", scope, "--ttl", "3600", "--json"),
        `wrangler artifacts repos issue-token ${repo}`);
      const t = jsonOf<{ plaintext?: unknown }>(p.stdout, "issue-token").plaintext;
      if (typeof t !== "string" || !t) throw new CliError(`issue-token for ${repo} returned no token`);
      return t;
    },
    fork(ns, src, dst) {
      ok(ns, src, dst);
      must(cf("artifacts", "namespaces", "repos", "fork", src, "--namespace", ns, "--body", JSON.stringify({ name: dst, default_branch_only: true })),
        `cf artifacts namespaces repos fork ${src}`);
    },
    remote(ns, repo) {
      if (!accountId) throw new CliError("account not confirmed");
      assertName("namespace", ns);
      if (repo) assertName("repo name", repo);
      return `https://${accountId}.artifacts.cloudflare.net/git/${ns}/${repo}.git`;
    },
  };
}
