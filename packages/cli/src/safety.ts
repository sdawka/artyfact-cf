/**
 * Input hardening for `artyfact init`: names that reach git, wrangler or cf argv, and project paths that are read and
 * pushed. Paths are resolved with realpath and must stay inside their root; symlinks are never followed out of it.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, statSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CliError } from "./git.ts";
import { isSecretFile } from "./ignore.ts";
import { isName, slug } from "./naming.ts";

/** The model's template ref (`template.<kind>.<name>@<version>`). */
const TEMPLATE_REF_RE = /^template\.[\w.-]+@[\w.-]+$/;

/** A name that ends up on an argv or in a URL: Artifacts name rule, never an option, never a path step. */
export function assertName(kind: string, v: unknown): string {
  if (!isName(v)) throw new CliError(`invalid ${kind}: ${JSON.stringify(v)}`);
  return v;
}

/** A system id that maps one-to-one onto repo names (see `slug`): checked before any network call. */
export function assertSystemId(v: unknown): string {
  assertName("system id", v);
  try {
    slug(v as string);
  } catch (e) {
    throw new CliError(`invalid system id: ${(e as Error).message}`);
  }
  return v as string;
}

export function assertTemplateRef(v: unknown): string {
  if (typeof v !== "string" || !TEMPLATE_REF_RE.test(v) || v.includes("..")) throw new CliError(`invalid template ref: ${JSON.stringify(v)}`);
  return v;
}

export const isInside = (root: string, p: string): boolean => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

/** realpath of an existing directory; with `within`, it must resolve inside that (already real) root. */
export function realDir(kind: string, path: string, within?: string): string {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    throw new CliError(`${kind} ${path} does not exist`);
  }
  if (!statSync(real).isDirectory()) throw new CliError(`${kind} ${path} is not a directory`);
  if (within && !isInside(within, real)) throw new CliError(`${kind} ${path} resolves to ${real}, outside ${within}`);
  return real;
}

/** A relative path from a config file (e.g. scaffold `path`), resolved inside `root` or refused. */
export function realSubdir(kind: string, root: string, rel: string): string {
  if (rel.startsWith("/") || rel.split(/[\\/]/).includes("..")) throw new CliError(`${kind} ${rel} must be a relative path inside the repo`);
  return realDir(kind, resolve(root, rel), root);
}

/** Directories never pushed or copied, whether or not the source is inside a git checkout. */
export const EXCLUDE_DIRS = new Set(["node_modules", ".wrangler", ".git", "dist", ".artyfact", ".tsbuild"]);
export const EXCLUDE_FILES = new Set([".artyfact.json", ".DS_Store"]);
export { isSecretFile };
const excluded = (rel: string) => {
  const parts = rel.split("/");
  const base = parts.at(-1)!;
  return parts.slice(0, -1).some((p) => EXCLUDE_DIRS.has(p)) || EXCLUDE_DIRS.has(base) || EXCLUDE_FILES.has(base) || isSecretFile(base)
    || base.endsWith(".tsbuildinfo");
};

/** Walk without following symlinks; a symlink is reported as an entry, never descended. */
function walkNoFollow(root: string, rel = ""): string[] {
  return readdirSync(join(root, rel)).sort().flatMap((n) => {
    const r = rel ? `${rel}/${n}` : n;
    if (excluded(r)) return [];
    const st = lstatSync(join(root, r));
    return st.isDirectory() ? walkNoFollow(root, r) : [r];
  });
}

/** Candidate files: the checkout's own ignore rules when `root` is inside git, else a no-follow walk. */
function candidates(root: string): string[] {
  const inside = spawnSync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return walkNoFollow(root);
  const r = spawnSync("git", ["-C", root, "--literal-pathspecs", "ls-files", "-z", "-co", "--exclude-standard", "--", "."], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new CliError(`git ls-files failed in ${root}`);
  return r.stdout.split("\0").filter(Boolean).filter((p) => !excluded(p));
}

/**
 * Files of `root` (real path) that may be pushed or copied: regular files whose directory resolves inside `root`, and
 * relative symlinks whose target resolves inside `root` (kept as links). Symlinks pointing outside, dangling ones and anything
 * else are skipped and reported.
 */
export function projectFiles(root: string): { files: string[]; skipped: string[] } {
  const files: string[] = [], skipped: string[] = [];
  for (const rel of candidates(root)) {
    const abs = join(root, rel);
    let st;
    try { st = lstatSync(abs); } catch { continue; }
    let parent: string;
    try { parent = realpathSync(dirname(abs)); } catch { skipped.push(rel); continue; }
    if (!isInside(root, parent)) { skipped.push(rel); continue; }
    if (st.isSymbolicLink()) {
      // Only relative links travel: an absolute target leaks a local path and dangles in any clone.
      if (isAbsolute(readlinkSync(abs))) { skipped.push(rel); continue; }
      let target: string;
      try { target = realpathSync(abs); } catch { skipped.push(rel); continue; }
      if (!isInside(root, target)) { skipped.push(rel); continue; }
      files.push(rel);
    } else if (st.isFile()) {
      files.push(rel);
    } else {
      skipped.push(rel);
    }
  }
  return { files, skipped };
}

/** Copy the selected files of `root` into `dst`; symlinks are recreated as links (their targets are inside `root`). */
export function copyFiles(root: string, files: string[], dst: string): void {
  for (const rel of files) {
    const from = join(root, rel), to = join(dst, rel);
    if (!isInside(dst, resolve(to))) throw new CliError(`refusing to write outside ${dst}: ${rel}`);
    mkdirSync(dirname(to), { recursive: true });
    if (lstatSync(from).isSymbolicLink()) {
      if (!existsSync(to)) symlinkSync(readlinkSync(from), to);
    } else {
      copyFileSync(from, to);
    }
  }
}

export const relativeTo = (root: string, p: string) => relative(root, p) || ".";
