/**
 * The namespace's `platform` meta repo (pushed by `artyfact platform-sync`). Read on import for provenance only:
 * template and rule-pack evaluation still uses the packages bundled into the Worker.
 */
import { PLATFORM_REPO, platformPackFile, platformTemplateDir } from "@artyfact/cli/naming";
import type { Finding, SystemModel } from "@artyfact/model";
import type { PlatformRef } from "../../shared/api";
import { artifactsErrorCode, withRepo, type ArtifactsNamespaceLike } from "./client";

const warning = (rule: string, subject: string, message: string): Finding => ({
  level: "warning", rule, subject, message, facts: [],
  derivation: { relation: rule, tuple: [subject], edb: true, children: [] },
});

/** The pins a System makes that `platform` should hold: rule packs and the templates its System and Things use. */
export function platformPins(m: Pick<SystemModel, "kits" | "templates">): { pin: string; path: string }[] {
  const packs = m.kits.rulePacks.map((p) => ({ pin: `${p.id}@${p.version}`, path: platformPackFile(p.id, p.version) }));
  const templates = m.templates.flatMap((t) => {
    const ref = `${t.id}@${t.version}`;
    const dir = platformTemplateDir(ref);
    return dir ? [{ pin: ref, path: `${dir}/template.yaml` }] : [];
  });
  return [...packs, ...templates];
}

export function unsyncedWarning(systemId: string): Finding {
  return warning("platform.unsynced", systemId, `no '${PLATFORM_REPO}' repo in this namespace; run 'npx artyfact platform-sync' to record template and rule-pack provenance`);
}

/** Head of `platform` and a warning per pin it lacks; `platform: null` + `platform.unsynced` when the repo is absent or empty. */
export async function readPlatform(ns: ArtifactsNamespaceLike, systemId: string, m: Pick<SystemModel, "kits" | "templates">): Promise<{ platform: PlatformRef | null; warnings: Finding[] }> {
  try {
    return await withRepo(ns, PLATFORM_REPO, async (repo) => {
      const [head] = await repo.log({ limit: 1 });
      if (!head) return { platform: null, warnings: [unsyncedWarning(systemId)] };
      const warnings: Finding[] = [];
      for (const { pin, path } of platformPins(m)) {
        const blob = await repo.readFile({ ref: head.hash, path }).catch((e: unknown) => {
          if (artifactsErrorCode(e) === "NOT_FOUND") return null;
          throw e;
        });
        if (!blob) {
          warnings.push(warning("platform.pin-missing", pin, `${PLATFORM_REPO}@${head.hash.slice(0, 7)} has no ${path} for pin ${pin}`));
        }
      }
      return { platform: { repo: PLATFORM_REPO, commit: head.hash }, warnings };
    });
  } catch (e) {
    if (artifactsErrorCode(e) === "NOT_FOUND") return { platform: null, warnings: [unsyncedWarning(systemId)] };
    throw e;
  }
}
