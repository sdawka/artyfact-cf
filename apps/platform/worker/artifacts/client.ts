/**
 * Cloudflare Artifacts access behind a narrow interface so tests never touch the remote binding.
 * `ArtifactsRepoLike` / `ArtifactsNamespaceLike` mirror the subset of the Workers binding we use
 * (https://developers.cloudflare.com/artifacts/api/workers-binding/).
 */

import { conflict } from "../errors";

export type TreeEntryType = "tree" | "blob" | "symlink" | "gitlink" | "exec";
export interface TreeEntry { name: string; mode: string; hash: string; type: TreeEntryType }
export interface CommitMeta {
  hash: string;
  treeHash: string;
  message: string;
  author: { name: string; email: string };
  committer: { name: string; email: string };
  parents: string[];
  authoredAt: number;
  committedAt: number;
}
export interface RepoInfo {
  id: string;
  name: string;
  defaultBranch: string;
  remote: string;
  source: string | null;
  readOnly: boolean;
  lastPushAt: string | null;
  /** Not in the published binding types; tolerated if present (`ready` once a fork completes). */
  status?: string;
}
export interface CreateTokenResult { id: string; plaintext: string; scope: "read" | "write"; expiresAt: string }
export interface CreateRepoResult { id: string; name: string; defaultBranch: string; remote: string; token: string }

export interface ArtifactsRepoLike {
  info(): Promise<RepoInfo>;
  createToken(scope?: "write" | "read", ttl?: number): Promise<CreateTokenResult>;
  revokeToken(tokenOrId: string): Promise<boolean>;
  fork(name: string, opts?: { description?: string; readOnly?: boolean; defaultBranchOnly?: boolean }): Promise<CreateRepoResult>;
  log(opts?: { ref?: string; limit?: number; offset?: number }): Promise<CommitMeta[]>;
  readCommit(hash: string): Promise<CommitMeta | null>;
  readTree(hash: string): Promise<TreeEntry[] | null>;
  readBlob(hash: string): Promise<Blob | null>;
  readFile(args: { ref: string; path: string }): Promise<Blob | null>;
  [Symbol.dispose]?(): void;
}

export interface ArtifactsNamespaceLike {
  get(name: string): Promise<ArtifactsRepoLike>;
}

let override: ArtifactsNamespaceLike | undefined;

/** Tests install an in-memory namespace here; production uses `env.ARTIFACTS`. */
export function setArtifactsOverride(ns: ArtifactsNamespaceLike | undefined): void {
  override = ns;
}

export function artifactsFor(env: Env): ArtifactsNamespaceLike {
  if (override) return override;
  const binding = (env as { ARTIFACTS?: Artifacts }).ARTIFACTS;
  if (!binding) throw new ArtifactsUnavailableError();
  return binding as unknown as ArtifactsNamespaceLike;
}

export class ArtifactsUnavailableError extends Error {
  constructor() {
    super("ARTIFACTS binding is not configured (remote binding requires a Cloudflare login)");
    this.name = "ArtifactsUnavailableError";
  }
}

/** Release an RPC result's stubs, if it carries any (plain data stays readable after disposal). */
export function disposeResult(v: unknown): void {
  const d = (v as { [Symbol.dispose]?: () => void } | null | undefined)?.[Symbol.dispose];
  if (typeof d === "function") d.call(v);
}

/**
 * The repo handle with every method's RPC result disposed as soon as it arrives. Workers RPC results that hold
 * stubs must be disposed; through the remote-binding proxy in local dev each result is disposable, and leaving one
 * to GC logs "An RPC result was not disposed properly".
 */
function disposingRepo(repo: ArtifactsRepoLike): ArtifactsRepoLike {
  return new Proxy(repo, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (typeof v !== "function" || prop === Symbol.dispose) return v;
      return async (...args: unknown[]) => {
        // Reflect.apply, not v.apply: an RPC method stub would treat `.apply` as a remote method name.
        const out = await (Reflect.apply(v as (...a: unknown[]) => Promise<unknown>, target, args) as Promise<unknown>);
        disposeResult(out);
        return out;
      };
    },
  });
}

/** Open a repo handle, run `fn`, dispose every RPC result, and always release the repo stub. */
export async function withRepo<T>(ns: ArtifactsNamespaceLike, name: string, fn: (repo: ArtifactsRepoLike) => Promise<T>): Promise<T> {
  const repo = await ns.get(name);
  try {
    return await fn(disposingRepo(repo));
  } finally {
    repo[Symbol.dispose]?.();
  }
}

/** Error code of an `ArtifactsError` (or anything shaped like one), else undefined. */
export function artifactsErrorCode(e: unknown): string | undefined {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string") return code;
  // Through the remote dev proxy the code is dropped and only "ArtifactsError: <text>" survives.
  const msg = (e as Error | null)?.message ?? "";
  if (!msg.includes("ArtifactsError")) return undefined;
  if (/not found/i.test(msg)) return "NOT_FOUND";
  if (/already exists/i.test(msg)) return "ALREADY_EXISTS";
  if (/fork.*in progress/i.test(msg)) return "FORK_IN_PROGRESS";
  if (/in progress/i.test(msg)) return "CREATE_IN_PROGRESS";
  return undefined;
}

export function remoteUrl(env: Env, repo: string, fallback?: string): string {
  // The fake platform's repos live in memory: their own remote, never the account's Artifacts host.
  if ((env as { FAKE_ARTIFACTS?: string }).FAKE_ARTIFACTS === "1" && fallback) return fallback;
  const account = (env as { ACCOUNT_ID?: string }).ACCOUNT_ID;
  if (account) return `https://${account}.artifacts.cloudflare.net/git/${env.ARTIFACTS_NAMESPACE}/${repo}.git`;
  if (fallback) return fallback;
  throw new Error("ACCOUNT_ID is not set; add it to .dev.vars or wrangler vars");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fork `base` as `name` and wait until it is usable. Tolerates ALREADY_EXISTS (a retried start)
 * and FORK_IN_PROGRESS on `get`. Ready = `get` + `info` succeed and `status`, if reported, is `ready`.
 * With `baseCommit`, an existing fork is reused only while its head is still that commit: a fork left over
 * from another run (e.g. fresh platform state, same Artifacts namespace) is refused with 409 `fork-exists`.
 */
export async function forkAndWait(
  ns: ArtifactsNamespaceLike,
  base: string,
  name: string,
  opts: { timeoutMs?: number; intervalMs?: number; baseCommit?: string } = {},
): Promise<{ remote?: string }> {
  const timeoutMs = opts.timeoutMs ?? 20_000, intervalMs = opts.intervalMs ?? 500;
  let remote: string | undefined;
  let existed = false;
  await withRepo(ns, base, async (repo) => {
    try {
      remote = (await repo.fork(name, { defaultBranchOnly: true })).remote;
    } catch (e) {
      if (artifactsErrorCode(e) !== "ALREADY_EXISTS" && artifactsErrorCode(e) !== "FORK_IN_PROGRESS") throw e;
      existed = artifactsErrorCode(e) === "ALREADY_EXISTS";
    }
  });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const info = await withRepo(ns, name, (r) => r.info());
      if (info.status === undefined || info.status === "ready") {
        if (existed && opts.baseCommit) {
          const [head] = await withRepo(ns, name, (r) => r.log({ limit: 1 }));
          if (head?.hash !== opts.baseCommit) {
            throw conflict("fork-exists", `repo ${name} already exists at ${head?.hash.slice(0, 12) ?? "no commit"}, not at base ${opts.baseCommit.slice(0, 12)}; delete it (wrangler artifacts repos delete ${name} --namespace <ns>) or reset the platform state`);
          }
        }
        return { remote: remote ?? info.remote };
      }
    } catch (e) {
      const code = artifactsErrorCode(e);
      if (code !== "FORK_IN_PROGRESS" && code !== "NOT_FOUND" && code !== "CREATE_IN_PROGRESS") throw e;
    }
    if (Date.now() >= deadline) throw new Error(`fork ${name} not ready after ${timeoutMs} ms`);
    await sleep(intervalMs);
  }
}
