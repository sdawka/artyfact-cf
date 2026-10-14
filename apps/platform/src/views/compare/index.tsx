import { Button } from "@/components/ui";
import { useSearchParams } from "react-router";
import type { FileScope } from "../../../shared/api";
import { useClientMode, useCompare, useRevisions } from "@/api/queries";
import { EmptyState } from "@/components/EmptyState/EmptyState";
import { Tabs } from "@/components/Tabs/Tabs";
import type { RevisionOption } from "@/model/revisions";
import { ComparePicker } from "./ComparePicker";
import { FilesLevel } from "./FilesLevel";
import { GenomeLevel } from "./GenomeLevel";
import { LEGACY_NOTICE } from "./legacy";
import { SystemLevel } from "./SystemLevel";
import { defaultPair } from "./pair";
import styles from "./compare.module.css";

type Level = "system" | "genome" | "files";
const LEVELS: { id: Level; label: string }[] = [
  { id: "system", label: "System" },
  { id: "genome", label: "Genome" },
  { id: "files", label: "Files" },
];
const HEAD_ONLY: RevisionOption[] = [{ id: "head", kind: "head", label: "head" }];
const isLevel = (v: string | null): v is Level => v === "system" || v === "genome" || v === "files";

/** Two revisions side by side at the System, Genome or file level (`?from=&to=&level=&path=`). */
export default function CompareView() {
  const [params, setParams] = useSearchParams();
  const revisions = useRevisions();
  const mode = useClientMode();
  const options = revisions.data ?? HEAD_ONLY;
  const { from, to } = defaultPair(options, params.get("from"), params.get("to"));
  const level: Level = isLevel(params.get("level")) ? (params.get("level") as Level) : "system";
  const path = params.get("path");
  const repoParam = params.get("repo");
  const repo: FileScope | null = repoParam === "app" || repoParam === "genome" ? repoParam : null;

  const system = useCompare({ level: "system", from, to });
  const genome = useCompare({ level: "genome", from, to });

  const update = (patch: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    }, { replace: true });

  const fixture = mode.data === "fixture";
  const legacy = !!(system.data?.genome.legacyFormat?.length || genome.data?.legacyFormat?.length);
  const current = level === "genome" ? genome : system;
  const identical = level === "system"
    ? system.data?.identical
    : level === "genome"
      ? !!genome.data?.delta && !genome.data.delta.added.length && !genome.data.delta.removed.length && !genome.data.delta.changed.length
      : system.data?.identical;

  return (
    <section aria-labelledby="view-title" className={styles.view}>
      <h1 id="view-title">Compare</h1>
      <ComparePicker from={from} to={to} options={options} onChange={(p) => update({ from: p.from, to: p.to, path: null, repo: null })} />
      {legacy && <p role="note" className={styles.muted}>{LEGACY_NOTICE}</p>}
      <Tabs tabs={LEVELS} value={level} onChange={(l) => update({ level: l === "system" ? null : l })} label="Compare level">
        {fixture ? (
          <EmptyState title="Compare needs the platform API.">
            The UI is showing fixture data, which has a single revision (head) and nothing to compare it with.
          </EmptyState>
        ) : current.isLoading || (level === "files" && genome.isLoading) ? (
          <p role="status">Comparing {from} with {to}…</p>
        ) : current.isError ? (
          <EmptyState
            title="Could not compare these revisions."
            action={<Button type="button" variant="secondary" onClick={() => void current.refetch()}>Retry</Button>}
          >
            {current.error.message}
          </EmptyState>
        ) : (
          <div className={styles.stack}>
            {identical && <p role="status" className={styles.identical}>The two revisions are identical{level === "genome" ? " in the Genome" : ""}.</p>}
            {level === "system" && system.data && <SystemLevel cmp={system.data} />}
            {level === "genome" && genome.data && <GenomeLevel cmp={genome.data} from={from} to={to} />}
            {level === "files" && (
              <FilesLevel from={from} to={to} app={system.data?.app} genome={genome.data?.files} path={path} repo={repo} />
            )}
          </div>
        )}
      </Tabs>
    </section>
  );
}
