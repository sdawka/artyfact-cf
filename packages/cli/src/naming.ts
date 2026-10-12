/**
 * Artifacts repo names for a System (slice 2.7). Dependency-free so the Worker and the CLI share it.
 * Repo names: start with a letter or digit; letters, digits, `.`, `_`, `-`.
 */

/** The namespace-level repo holding the platform's templates, rule packs and manifest. */
export const PLATFORM_REPO = "platform";

/** `system.Keep-In-Touch` -> `keep-in-touch`. Throws when nothing usable is left. */
export function slug(systemId: string): string {
  const s = systemId.replace(/^system\./, "").toLowerCase().replace(/[^a-z0-9._-]/g, "").replace(/^[^a-z0-9]+/, "");
  if (!s) throw new Error(`cannot derive a repo slug from system id ${JSON.stringify(systemId)}`);
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
