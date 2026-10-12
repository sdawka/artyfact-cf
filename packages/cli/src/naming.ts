/**
 * Artifacts repo names for a System (slice 2.7). Dependency-free so the Worker and the CLI share it.
 * Repo names: start with a letter or digit; letters, digits, `.`, `_`, `-`.
 */

/** The namespace-level repo holding the platform's templates, rule packs and manifest. */
export const PLATFORM_REPO = "platform";

/** Artifacts repo and namespace names. `..` is refused too, so a name is never an option or a path step. */
export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const isName = (v: unknown): v is string => typeof v === "string" && NAME_RE.test(v) && !v.includes("..");

/**
 * `system.Keep-In-Touch` -> `keep-in-touch`: the lower-cased id without `system.`. Throws when that is not a valid
 * name, so two ids can never collapse onto the same repos (`system.a/b`, `system.Ünïcode` are refused).
 */
export function slug(systemId: string): string {
  const s = systemId.replace(/^system\./, "").toLowerCase();
  if (!isName(s)) throw new Error(`system id ${JSON.stringify(systemId)} does not give a valid repo slug (letters, digits, '.', '_', '-'; no '..')`);
  return s;
}

export const genomeRepoName = (s: string): string => `${s}.genome`;

/**
 * `<slug>.app` for the single worker-fullstack artifact; with several, `<slug>.<artifactId without "artifact.">`.
 */
export function appRepoName(s: string, artifactId?: string, multiple = false): string {
  if (!multiple || !artifactId) return `${s}.app`;
  return `${s}.${artifactId.replace(/^artifact\./, "")}`;
}

/** Fork of `repo` for realization number `n`: `<slug>.app--r3`, `<slug>.genome--r4`. */
export const forkName = (repo: string, n: number): string => `${repo}--r${n}`;

/** Integration-test repos live in namespace `artyfact-test` under `itest-<slug>-<run>`. */
export const ITEST_NAMESPACE = "artyfact-test";
export const itestPrefix = (s: string, run: string): string => `itest-${s}-${run}`;

export interface SystemRepoNames { slug: string; genomeRepo: string; appRepo: string }

/** Names for a System, given its worker-fullstack artifact ids (the first is the one bound as the app). */
export function systemRepoNames(systemId: string, appArtifactIds: string[] = []): SystemRepoNames {
  const s = slug(systemId);
  return { slug: s, genomeRepo: genomeRepoName(s), appRepo: appRepoName(s, appArtifactIds[0], appArtifactIds.length > 1) };
}

/**
 * Layout of the `platform` repo: `templates/{system,thing}/<name>@<v>/` (template files; Thing templates may carry
 * `scaffold/`), `templates/rule-packs/<id>@<v>/pack.dl`, `README.md`, `manifest.json` `{version, bundleHash}`.
 */
export function platformTemplateDir(ref: string): string | undefined {
  const m = /^template\.(system|thing)\.([\w.-]+@[\w.-]+)$/.exec(ref);
  return m ? `templates/${m[1]}/${m[2]}` : undefined;
}
export const platformPackFile = (id: string, version: string): string => `templates/rule-packs/${id}@${version}/pack.dl`;
